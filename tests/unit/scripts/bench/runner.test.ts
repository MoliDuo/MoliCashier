import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { GenerateStructured } from "@/lib/ai/structured";
import { loadCases } from "../../../../scripts/bench/lib/cases";
import {
  compareRuns,
  formatSummary,
  summarize,
  type ResultFile,
} from "../../../../scripts/bench/lib/report";
import { runBenchmark, type BenchCase } from "../../../../scripts/bench/lib/runner";
import { parseExpectSchema, type BenchLabels } from "../../../../scripts/bench/lib/schema";
import { defineTask } from "../../../../scripts/bench/tasks/types";
import { GOLD_LABELS, makeDataDir, writeFixtureCase } from "../../../helpers/bench-dataset";

function benchCase(id: string, labels: BenchLabels = GOLD_LABELS): BenchCase {
  return {
    document: {
      schemaVersion: 1,
      id,
      title: id,
      text: "",
      images: [],
      ledger: { categories: [], preferredCurrencies: [], aiLanguage: "en", customPrompt: "" },
    },
    images: [],
    labels,
    expect: {},
  };
}

/** Passes unless the model answers "bad", throws on "boom". */
const echoTask = defineTask<unknown, string>({
  name: "echo",
  expectSchema: parseExpectSchema,
  check: () => [],
  run: ({ generate, signal }) =>
    generate({
      task: "echo",
      schema: z.string(),
      system: "p",
      messages: [],
      maxTokens: 16,
      temperature: 0,
      signal,
    }),
  score: ({ output }) => {
    if (output === "boom") throw new Error("scoring blew up");
    return { pass: output !== "bad", metrics: { good: output === "bad" ? 0 : 1 }, notes: [] };
  },
});

/** A generator that answers every call with `content`, reporting fixed token usage. */
function fakeGenerate(content: string, usage = { promptTokens: 10, completionTokens: 2 }) {
  const generate: GenerateStructured = async (request) => {
    request.onUsage?.(usage);
    return request.schema.parse(content);
  };
  return () => generate;
}

describe("benchmark runner", () => {
  it("runs every case the requested number of times and meters tokens", async () => {
    const results = await runBenchmark({
      task: echoTask,
      cases: [benchCase("a"), benchCase("b")],
      repeat: 3,
      concurrency: 2,
      createGenerate: fakeGenerate("ok"),
    });
    expect(results.map((result) => result.runs.length)).toEqual([3, 3]);
    expect(results[0]?.runs[0]?.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
    expect(results.flatMap((result) => result.runs).every((run) => run.pass)).toBe(true);
  });

  it("records a throwing run as a failed run with its error, not as a crash", async () => {
    const results = await runBenchmark({
      task: echoTask,
      cases: [benchCase("a")],
      repeat: 1,
      concurrency: 1,
      createGenerate: fakeGenerate("boom"),
    });
    expect(results[0]?.runs[0]).toMatchObject({
      pass: false,
      error: { code: "Error", message: "scoring blew up" },
    });
  });

  it("follows the cause chain but never copies a cause's message, which may quote a credential", async () => {
    const failing = defineTask<unknown, string>({
      name: "failing",
      expectSchema: parseExpectSchema,
      check: () => [],
      run: async () => {
        const provider = Object.assign(new Error("Incorrect API key provided: sk-secret"), {
          status: 401,
          code: "invalid_api_key",
        });
        throw new Error("Parser AI request failed", { cause: provider });
      },
      score: () => ({ pass: true, metrics: {}, notes: [] }),
    });
    const results = await runBenchmark({
      task: failing,
      cases: [benchCase("a")],
      repeat: 1,
      concurrency: 1,
      createGenerate: fakeGenerate("ok"),
    });
    expect(results[0]?.runs[0]?.error?.message).toBe(
      "Parser AI request failed <- Error invalid_api_key status 401"
    );
  });

  it("stops starting new runs once the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runBenchmark({
      task: echoTask,
      cases: [benchCase("a")],
      repeat: 5,
      concurrency: 1,
      signal: controller.signal,
      createGenerate: fakeGenerate("ok"),
    });
    expect(results[0]?.runs).toEqual([]);
  });
});

describe("benchmark summary", () => {
  const run = (pass: boolean) => ({
    pass,
    metrics: { good: pass ? 1 : 0 },
    notes: [],
    latencyMs: 100,
    usage: { promptTokens: 5, completionTokens: 1 },
  });
  const cases = [
    {
      documentId: "stable",
      labels: { ...GOLD_LABELS, rules: ["a"] },
      runs: [run(true), run(true)],
    },
    {
      documentId: "flaky",
      labels: { ...GOLD_LABELS, rules: ["a", "b"] },
      runs: [run(true), run(false)],
    },
    {
      documentId: "broken",
      labels: { ...GOLD_LABELS, rules: ["b"] },
      runs: [run(false), run(false)],
    },
  ];

  it("separates stable, flaky and failing cases and groups by rule", () => {
    const summary = summarize(cases);
    expect(summary).toMatchObject({
      cases: 3,
      runs: 6,
      allPass: 1,
      allFail: 1,
      flaky: 1,
      tokens: { prompt: 30, completion: 6 },
    });
    expect(summary.passRate).toBeCloseTo(0.5);
    expect(summary.byRule.a).toEqual({ cases: 2, passRate: 0.75 });
    expect(summary.byRule.b).toEqual({ cases: 2, passRate: 0.25 });
  });

  it("prints case ids but no amounts or notes", () => {
    const file: ResultFile = {
      schemaVersion: 1,
      task: "parse",
      model: "m",
      label: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      repeat: 2,
      cases: cases.map((result) => ({
        ...result,
        runs: result.runs.map((entry) => ({
          ...entry,
          notes: ["total CNY|Food: expected 45, got 40"],
        })),
      })),
    };
    const text = formatSummary(file, summarize(file.cases));
    expect(text).toContain("flaky  50.0%");
    expect(text).not.toContain("expected 45");
  });

  it("compares two runs by case pass rate", () => {
    const file = (rates: Record<string, boolean[]>): ResultFile => ({
      schemaVersion: 1,
      task: "parse",
      model: "m",
      label: null,
      startedAt: "",
      repeat: 2,
      cases: Object.entries(rates).map(([documentId, passes]) => ({
        documentId,
        labels: GOLD_LABELS,
        runs: passes.map(run),
      })),
    });
    const comparison = compareRuns(
      file({ a: [true, true], b: [false, false], c: [true, true], d: [true, true] }),
      file({ a: [true, false], b: [true, true], c: [true, true], e: [true, true] })
    );
    expect(comparison.regressed).toEqual([{ documentId: "a", before: 1, after: 0.5 }]);
    expect(comparison.improved).toEqual([{ documentId: "b", before: 0, after: 1 }]);
    expect(comparison.onlyBefore).toEqual(["d"]);
    expect(comparison.onlyAfter).toEqual(["e"]);
  });
});

describe("case selection", () => {
  const parseNamed = defineTask<unknown, string>({
    name: "parse",
    expectSchema: parseExpectSchema,
    check: () => [],
    run: async () => "",
    score: () => ({ pass: true, metrics: {}, notes: [] }),
  });

  const SUCCESS = {
    outcome: "success" as const,
    entries: [{ itemName: "Lunch", amount: "45.00", currency: "CNY", category: "Food" }],
  };

  it("defaults to gold cases and filters by rule, id and limit", () => {
    const dir = makeDataDir();
    writeFixtureCase(dir, "doc-gold", { text: "x", expect: SUCCESS });
    writeFixtureCase(dir, "doc-cand", {
      text: "x",
      expect: SUCCESS,
      labels: { ...GOLD_LABELS, status: "candidate", rules: ["other"] },
    });
    const ids = (selection: Parameters<typeof loadCases>[2]) =>
      loadCases(dir, parseNamed, selection).cases.map((entry) => entry.document.id);

    expect(ids({ status: "gold" })).toEqual(["doc-gold"]);
    expect(ids({ status: "all" })).toEqual(["doc-cand", "doc-gold"]);
    expect(ids({ status: "all", rule: "other" })).toEqual(["doc-cand"]);
    expect(ids({ status: "all", idContains: "gold" })).toEqual(["doc-gold"]);
    expect(ids({ status: "all", limit: 1 })).toEqual(["doc-cand"]);
  });

  it("reports an annotation the task's own check rejects instead of loading it", () => {
    const dir = makeDataDir();
    writeFixtureCase(dir, "doc-bad", { text: "x", expect: SUCCESS });
    const strict = defineTask<unknown, string>({
      name: "parse",
      expectSchema: parseExpectSchema,
      check: () => ["category is unknown"],
      run: async () => "",
      score: () => ({ pass: true, metrics: {}, notes: [] }),
    });
    const loaded = loadCases(dir, strict, { status: "gold" });
    expect(loaded.cases).toEqual([]);
    expect(loaded.problems).toEqual(["parse/doc-bad: category is unknown"]);
  });
});
