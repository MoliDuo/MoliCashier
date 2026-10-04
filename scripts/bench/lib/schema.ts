/**
 * The benchmark's data contract.
 *
 * A dataset is documents plus annotations. A document is the input a task
 * receives (text, images, the ledger's categories and settings); an annotation
 * is one task's expected answer for one document. Splitting them lets several
 * tasks share one document — and its images — instead of each carrying a copy.
 *
 *   <data dir>/documents/<id>/document.json
 *   <data dir>/documents/<id>/evidence/<file>
 *   <data dir>/annotations/<task>/<id>.json
 */
import { z } from "zod";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase SHA-256 hex digest");
const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and -");
const decimalSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a decimal string");

export const SCHEMA_VERSION = 1;

export const documentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: idSchema,
    /** For a human reading the file; never an input to a task. */
    title: z.string(),
    text: z.string(),
    images: z.array(
      z
        .object({
          file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must be a plain file name"),
          sha256: sha256Schema,
          contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/),
        })
        .strict()
    ),
    ledger: z
      .object({
        categories: z.array(
          z.object({ name: z.string().min(1), description: z.string() }).strict()
        ),
        preferredCurrencies: z.array(z.string()),
        aiLanguage: z.string().min(1),
        customPrompt: z.string(),
      })
      .strict(),
  })
  .strict();

export type BenchDocument = z.infer<typeof documentSchema>;

/**
 * Three independent axes, where the old single `tags` array mixed review state,
 * selection, origin and symptom.
 */
export const labelsSchema = z
  .object({
    /** `gold` takes part in a default run; `candidate` and `needs-fix` do not. */
    status: z.enum(["gold", "candidate", "needs-fix"]),
    /** The prompt rules this case exercises, e.g. `refund-stacked`. Free-form kebab-case. */
    rules: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
    provenance: z.enum(["production", "synthetic"]),
    /** A person corrected the expected answer after the AI first produced it. */
    humanCorrected: z.boolean(),
  })
  .strict();

export type BenchLabels = z.infer<typeof labelsSchema>;

/** The shared envelope; each task supplies the schema of its own `expect`. */
export function annotationSchema<T extends z.ZodType>(task: string, expect: T) {
  return z
    .object({
      schemaVersion: z.literal(SCHEMA_VERSION),
      task: z.literal(task),
      documentId: idSchema,
      labels: labelsSchema,
      expect,
    })
    .strict();
}

export interface Annotation<E> {
  schemaVersion: typeof SCHEMA_VERSION;
  task: string;
  documentId: string;
  labels: BenchLabels;
  expect: E;
}

export const parseExpectSchema = z
  .object({
    outcome: z.enum(["success", "invalid"]),
    /**
     * What the ledger ends up holding, adjustments included: the app saves a
     * bill-level discount or fee as an independent signed entry, so the answer
     * does not tell items from adjustments. Names are for reading, not scored.
     */
    entries: z.array(
      z
        .object({
          itemName: z.string(),
          amount: decimalSchema,
          currency: z.string().regex(/^[A-Z]{3}$/),
          /** A name from the document's ledger categories, or null for none. */
          category: z.string().nullable(),
        })
        .strict()
    ),
  })
  .strict()
  .refine((expect) => expect.outcome === "success" || expect.entries.length === 0, {
    message: "an invalid document has no entries",
    path: ["entries"],
  });

export type ParseExpect = z.infer<typeof parseExpectSchema>;

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** document id -> SHA-256 of document.json (which in turn pins every image). */
    documents: z.record(idSchema, sha256Schema),
    /** task -> document id -> SHA-256 of the annotation file. */
    annotations: z.record(z.string(), z.record(idSchema, sha256Schema)),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;
