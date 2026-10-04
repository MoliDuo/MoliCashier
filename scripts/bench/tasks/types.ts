import type { z } from "zod";
import type { AiContextContract } from "@/modules/source-document/domain/parse/contracts";
import type { BenchDocument } from "../lib/schema";

/** How one run of a task fared against its annotation. */
export interface Score {
  pass: boolean;
  /** Named figures in 0..1, averaged across runs and cases by the report. */
  metrics: Record<string, number>;
  /** What differed, for a person reading a failure. Holds real amounts: keep it out of the terminal by default. */
  notes: string[];
}

export interface TaskRunContext {
  document: BenchDocument;
  images: readonly { dataUrl: string }[];
  ai: AiContextContract;
  signal: AbortSignal;
}

/**
 * One benchmarked prompt. A task knows how to call the production code for one
 * document and how to score what came back; everything else — loading, repeats,
 * concurrency, reporting — is shared.
 */
export interface BenchTask {
  readonly name: string;
  readonly expectSchema: z.ZodType;
  /** Problems between an annotation and its document that a schema cannot see. */
  check(document: BenchDocument, expect: unknown): string[];
  /** Calls the production function, then scores its answer. */
  evaluate(context: TaskRunContext & { expect: unknown }): Promise<Score>;
}

interface TaskSpec<E, O> {
  name: string;
  expectSchema: z.ZodType<E>;
  check(document: BenchDocument, expect: E): string[];
  run(context: TaskRunContext): Promise<O>;
  score(args: { document: BenchDocument; expect: E; output: O }): Score;
}

/** Ties a task's expectation and output types together behind the untyped runner interface. */
export function defineTask<E, O>(spec: TaskSpec<E, O>): BenchTask {
  return {
    name: spec.name,
    expectSchema: spec.expectSchema,
    check: (document, expect) => spec.check(document, expect as E),
    async evaluate(context) {
      const output = await spec.run(context);
      return spec.score({ document: context.document, expect: context.expect as E, output });
    },
  };
}
