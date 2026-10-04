/**
 * Runs a prompt benchmark against the configured AI model:
 *
 *   npm run bench:prompt -- --task parse [--repeat 3] [--concurrency 4]
 *     [--model <name>] [--status gold|all] [--rule <label>] [--id <text>]
 *     [--limit <n>] [--baseline <result file>] [--label <name>] [--dry-run]
 *
 * It calls the production code on real documents, so it needs a data
 * directory (CASHIER_BENCH_DATA_DIR) and the same OPENAI_API_KEY, OPENAI_BASE_URL and
 * AI_MODEL the app uses. It is not part of `npm run check`: it costs money and its answers vary.
 * `--dry-run` loads and verifies the cases without calling the model.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnvironment } from "../load-local-environment";
import { loadCases } from "./lib/cases";
import { resolveDataDir } from "./lib/data-dir";
import { readManifest, verifyAgainstManifest } from "./lib/manifest";
import {
  compareRuns,
  formatComparison,
  formatSummary,
  readResultFile,
  summarize,
  type ResultFile,
} from "./lib/report";
import { runBenchmark } from "./lib/runner";
import { loadTask, TASK_NAMES } from "./tasks";

const positiveInteger = z.coerce.number().int().min(1);

const optionsSchema = z
  .object({
    task: z.string().default("parse"),
    repeat: positiveInteger.default(3),
    concurrency: positiveInteger.max(16).default(4),
    model: z.string().min(1).optional(),
    status: z.enum(["gold", "all"]).default("gold"),
    rule: z.string().optional(),
    id: z.string().optional(),
    limit: positiveInteger.optional(),
    baseline: z.string().optional(),
    label: z.string().optional(),
    "dry-run": z.boolean().default(false),
  })
  .strict();

function parseOptions(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      task: { type: "string" },
      repeat: { type: "string" },
      concurrency: { type: "string" },
      model: { type: "string" },
      status: { type: "string" },
      rule: { type: "string" },
      id: { type: "string" },
      limit: { type: "string" },
      baseline: { type: "string" },
      label: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });
  const parsed = optionsSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(
      `${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}\n` +
        `known tasks: ${TASK_NAMES.join(", ")}`
    );
  }
  return parsed.data;
}

function timestampForFilename(date: Date): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  loadLocalEnvironment();
  // The logger reads its level when first imported, which happens below with the task.
  process.env.LOG_LEVEL ??= "warn";
  if (options.model != null) process.env.AI_MODEL = options.model;

  const dataDir = resolveDataDir();
  const task = await loadTask(options.task);
  const { cases, problems } = loadCases(dataDir, task, {
    status: options.status,
    ...(options.rule == null ? {} : { rule: options.rule }),
    ...(options.id == null ? {} : { idContains: options.id }),
    ...(options.limit == null ? {} : { limit: options.limit }),
  });
  if (problems.length > 0) throw new Error(`annotation problems:\n${problems.join("\n")}`);
  if (cases.length === 0) throw new Error("no cases match the selection");

  const verification = verifyAgainstManifest(dataDir, readManifest(), {
    documentIds: cases.map((benchCase) => benchCase.document.id),
    annotations: cases.map((benchCase) => ({ task: task.name, id: benchCase.document.id })),
  });
  for (const warning of verification.warnings) console.warn(`warning: ${warning}`);
  if (verification.errors.length > 0) {
    throw new Error(`data does not match the manifest:\n${verification.errors.join("\n")}`);
  }
  console.log(`${cases.length} ${task.name} cases loaded and verified against the manifest`);
  if (options["dry-run"]) return;

  const { OpenAIClient } = await import("@/lib/ai/openai-client");
  const { createAIContext } = await import("@/lib/tasks/ai-context");
  const { runtimeEnv } = await import("@/lib/env/runtime");
  const model = runtimeEnv.aiModel;
  // One OpenAIClient serializes its own requests, so concurrency needs a client per slot.
  const clients = Array.from({ length: options.concurrency }, () => new OpenAIClient());
  let nextClient = 0;

  const interrupt = new AbortController();
  process.once("SIGINT", () => interrupt.abort());

  const startedAt = new Date();
  const caseResults = await runBenchmark({
    task,
    cases,
    repeat: options.repeat,
    concurrency: options.concurrency,
    signal: interrupt.signal,
    createAi: (signal) => {
      const client = clients[nextClient++ % clients.length] ?? clients[0];
      if (client == null) throw new Error("no AI client available");
      return createAIContext({ signal, getClient: () => client, model });
    },
    onRunFinished: ({ done, total }) => {
      if (done % 10 === 0 || done === total) console.log(`  ${done}/${total} runs`);
    },
  });

  const file: ResultFile = {
    schemaVersion: 1,
    task: task.name,
    model,
    label: options.label ?? null,
    startedAt: startedAt.toISOString(),
    repeat: options.repeat,
    cases: caseResults,
  };
  const resultsDir = path.join(dataDir, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const outputPath = path.join(
    resultsDir,
    `${task.name}-${timestampForFilename(startedAt)}${options.label == null ? "" : `-${options.label}`}.json`
  );
  fs.writeFileSync(outputPath, `${JSON.stringify(file, null, 2)}\n`);

  console.log(`\n${formatSummary(file, summarize(caseResults))}`);
  if (options.baseline != null) {
    const baseline = readResultFile(options.baseline);
    console.log(
      `\n${formatComparison(compareRuns(baseline, file), baseline.repeat !== file.repeat)}`
    );
  }
  console.log(`\nresults (with expected and actual amounts) written to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
