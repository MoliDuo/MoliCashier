/**
 * Runs a task over a set of cases, each several times.
 *
 * The app's AI calls default to temperature 1, so one run of one case says
 * little: a case that passes two runs in three is flaky, not fine. Every case
 * runs `repeat` times and the report keeps each run, so pass rate and the
 * flaky/stable split come from the same data.
 */
import type { AiContextContract } from "@/modules/source-document/domain/parse/contracts";
import type { BenchDocument, BenchLabels } from "./schema";
import type { BenchTask } from "../tasks/types";

export interface BenchCase {
  document: BenchDocument;
  images: readonly { dataUrl: string }[];
  labels: BenchLabels;
  expect: unknown;
}

export interface RunRecord {
  pass: boolean;
  metrics: Record<string, number>;
  notes: string[];
  /** Set when the run threw instead of producing an answer. */
  error?: { code: string; message: string };
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number };
}

export interface CaseResult {
  documentId: string;
  labels: BenchLabels;
  runs: RunRecord[];
}

export interface RunOptions {
  task: BenchTask;
  cases: readonly BenchCase[];
  repeat: number;
  concurrency: number;
  /** One AI context per call; the caller decides how clients are shared. */
  createAi: (signal: AbortSignal) => AiContextContract;
  signal?: AbortSignal;
  onRunFinished?: (progress: { done: number; total: number }) => void;
}

/** `name`, `code` and HTTP `status` of an error: enough to tell failures apart, never a message that may quote a credential. */
function describeLink(error: unknown): string {
  if (typeof error !== "object" || error == null) return "unknown";
  const parts = [error instanceof Error ? error.name : "Error"];
  if ("code" in error && typeof error.code === "string") parts.push(error.code);
  if ("status" in error && typeof error.status === "number") parts.push(`status ${error.status}`);
  return parts.join(" ");
}

/**
 * The pipeline wraps provider failures ("Parser AI request failed"), so the
 * message follows the cause chain to say what actually went wrong.
 */
function describeError(error: unknown): { code: string; message: string } {
  const code =
    typeof error === "object" && error != null && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  const causes: string[] = [];
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  while (cause != null && causes.length < 3) {
    causes.push(describeLink(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return {
    code,
    message: [message.slice(0, 300), ...causes].join(" <- "),
  };
}

/** Wraps the AI context so each run reports the tokens it spent. */
function meter(ai: AiContextContract, usage: RunRecord["usage"]): AiContextContract {
  return {
    async generate(options) {
      const response = await ai.generate(options);
      if (response.usage != null) {
        usage.promptTokens += response.usage.promptTokens;
        usage.completionTokens += response.usage.completionTokens;
      }
      return response;
    },
  };
}

async function runOnce(options: RunOptions, benchCase: BenchCase): Promise<RunRecord> {
  const usage = { promptTokens: 0, completionTokens: 0 };
  const startedAt = Date.now();
  const signal = options.signal ?? new AbortController().signal;
  try {
    const score = await options.task.evaluate({
      document: benchCase.document,
      images: benchCase.images,
      expect: benchCase.expect,
      ai: meter(options.createAi(signal), usage),
      signal,
    });
    return { ...score, latencyMs: Date.now() - startedAt, usage };
  } catch (error) {
    return {
      pass: false,
      metrics: {},
      notes: [],
      error: describeError(error),
      latencyMs: Date.now() - startedAt,
      usage,
    };
  }
}

export async function runBenchmark(options: RunOptions): Promise<CaseResult[]> {
  const results: CaseResult[] = options.cases.map((benchCase) => ({
    documentId: benchCase.document.id,
    labels: benchCase.labels,
    runs: [],
  }));
  const jobs = options.cases.flatMap((_, caseIndex) =>
    Array.from({ length: options.repeat }, () => caseIndex)
  );
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (options.signal?.aborted === true) return;
      const index = next++;
      const caseIndex = jobs[index];
      if (caseIndex == null) return;
      const benchCase = options.cases[caseIndex];
      const result = results[caseIndex];
      if (benchCase == null || result == null) return;
      result.runs.push(await runOnce(options, benchCase));
      done += 1;
      options.onRunFinished?.({ done, total: jobs.length });
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(options.concurrency, jobs.length)) }, worker)
  );
  return results;
}
