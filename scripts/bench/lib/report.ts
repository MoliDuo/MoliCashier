/** Turning case results into a summary, a printable report, and a comparison with an earlier run. */
import fs from "node:fs";
import { z } from "zod";
import type { CaseResult } from "./runner";

export interface ResultFile {
  schemaVersion: 1;
  task: string;
  model: string;
  label: string | null;
  startedAt: string;
  repeat: number;
  cases: CaseResult[];
}

const resultFileShape = z
  .object({
    schemaVersion: z.literal(1),
    task: z.string(),
    model: z.string(),
    label: z.string().nullable(),
    startedAt: z.string(),
    repeat: z.number().int().min(1),
    cases: z.array(
      z
        .object({
          documentId: z.string(),
          runs: z.array(z.object({ pass: z.boolean() }).passthrough()),
        })
        .passthrough()
    ),
  })
  .passthrough();

/** Reads a result file written by an earlier run; only the fields a comparison needs are checked. */
export function readResultFile(file: string): ResultFile {
  return resultFileShape.parse(JSON.parse(fs.readFileSync(file, "utf8"))) as unknown as ResultFile;
}

export interface Summary {
  cases: number;
  runs: number;
  /** Mean over cases of each case's own pass rate. */
  passRate: number;
  /** Cases passing every run, no run, or some. */
  allPass: number;
  allFail: number;
  flaky: number;
  erroredRuns: number;
  /** Mean of each metric over the runs that produced one. */
  metrics: Record<string, number>;
  byRule: Record<string, { cases: number; passRate: number }>;
  tokens: { prompt: number; completion: number };
  latencyMs: { p50: number; p95: number };
}

export function casePassRate(result: CaseResult): number {
  return result.runs.length === 0
    ? 0
    : result.runs.filter((run) => run.pass).length / result.runs.length;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

export function summarize(cases: readonly CaseResult[]): Summary {
  const runs = cases.flatMap((result) => result.runs);
  const metricValues = new Map<string, number[]>();
  for (const run of runs) {
    for (const [name, value] of Object.entries(run.metrics)) {
      metricValues.set(name, [...(metricValues.get(name) ?? []), value]);
    }
  }

  const rates = cases.map(casePassRate);
  const ruleRates = new Map<string, number[]>();
  cases.forEach((result, index) => {
    for (const rule of result.labels.rules) {
      ruleRates.set(rule, [...(ruleRates.get(rule) ?? []), rates[index] ?? 0]);
    }
  });

  const latencies = runs.map((run) => run.latencyMs).sort((a, b) => a - b);
  return {
    cases: cases.length,
    runs: runs.length,
    passRate: mean(rates),
    allPass: rates.filter((rate) => rate === 1).length,
    allFail: rates.filter((rate) => rate === 0).length,
    flaky: rates.filter((rate) => rate > 0 && rate < 1).length,
    erroredRuns: runs.filter((run) => run.error != null).length,
    metrics: Object.fromEntries([...metricValues].map(([name, values]) => [name, mean(values)])),
    byRule: Object.fromEntries(
      [...ruleRates]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rule, values]) => [rule, { cases: values.length, passRate: mean(values) }])
    ),
    tokens: {
      prompt: runs.reduce((sum, run) => sum + run.usage.promptTokens, 0),
      completion: runs.reduce((sum, run) => sum + run.usage.completionTokens, 0),
    },
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** The terminal report. Case ids only: expected and actual amounts stay in the result file. */
export function formatSummary(file: ResultFile, summary: Summary): string {
  const lines = [
    `task ${file.task} · model ${file.model}${file.label == null ? "" : ` · ${file.label}`}`,
    `${summary.cases} cases × ${file.repeat} runs`,
    `pass rate ${percent(summary.passRate)}  (always ${summary.allPass}, never ${summary.allFail}, flaky ${summary.flaky}; errored runs ${summary.erroredRuns})`,
    `metrics ${Object.entries(summary.metrics)
      .map(([name, value]) => `${name} ${percent(value)}`)
      .join("  ")}`,
    `tokens ${summary.tokens.prompt} in / ${summary.tokens.completion} out · latency p50 ${summary.latencyMs.p50}ms p95 ${summary.latencyMs.p95}ms`,
  ];
  const errors = new Map<string, number>();
  for (const result of file.cases) {
    for (const run of result.runs) {
      const error = (run as { error?: { message: string } }).error;
      if (error != null) errors.set(error.message, (errors.get(error.message) ?? 0) + 1);
    }
  }
  if (errors.size > 0) {
    lines.push("errors:");
    for (const [message, count] of errors) lines.push(`  ${count}× ${message}`);
  }
  const rules = Object.entries(summary.byRule);
  if (rules.length > 0) {
    lines.push("by rule:");
    for (const [rule, value] of rules) {
      lines.push(`  ${rule.padEnd(28)} ${percent(value.passRate).padStart(6)}  (${value.cases})`);
    }
  }
  const failing = file.cases.filter((result) => casePassRate(result) < 1);
  if (failing.length > 0) {
    lines.push("not always passing:");
    for (const result of failing) {
      lines.push(`  ${result.documentId}  ${percent(casePassRate(result))}`);
    }
  }
  return lines.join("\n");
}

export interface Comparison {
  regressed: { documentId: string; before: number; after: number }[];
  improved: { documentId: string; before: number; after: number }[];
  /** Cases present in only one of the two runs. */
  onlyBefore: string[];
  onlyAfter: string[];
}

export function compareRuns(before: ResultFile, after: ResultFile): Comparison {
  const earlier = new Map(before.cases.map((result) => [result.documentId, casePassRate(result)]));
  const comparison: Comparison = { regressed: [], improved: [], onlyBefore: [], onlyAfter: [] };
  for (const result of after.cases) {
    const rate = casePassRate(result);
    const previous = earlier.get(result.documentId);
    if (previous == null) comparison.onlyAfter.push(result.documentId);
    else if (rate < previous)
      comparison.regressed.push({ documentId: result.documentId, before: previous, after: rate });
    else if (rate > previous)
      comparison.improved.push({ documentId: result.documentId, before: previous, after: rate });
    earlier.delete(result.documentId);
  }
  comparison.onlyBefore.push(...earlier.keys());
  return comparison;
}

export function formatComparison(comparison: Comparison, repeatsDiffer: boolean): string {
  const lines = [
    `compared with baseline: ${comparison.regressed.length} regressed, ${comparison.improved.length} improved`,
  ];
  if (repeatsDiffer)
    lines.push("  (the two runs used different repeat counts; small shifts are noise)");
  for (const [title, rows] of [
    ["regressed", comparison.regressed],
    ["improved", comparison.improved],
  ] as const) {
    for (const row of rows) {
      lines.push(`  ${title} ${row.documentId}  ${percent(row.before)} -> ${percent(row.after)}`);
    }
  }
  if (comparison.onlyAfter.length + comparison.onlyBefore.length > 0) {
    lines.push(
      `  not in both runs: ${comparison.onlyBefore.length} only in baseline, ${comparison.onlyAfter.length} only in this run`
    );
  }
  return lines.join("\n");
}
