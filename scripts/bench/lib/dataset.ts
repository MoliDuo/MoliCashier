/** Reading documents and annotations from the data directory. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import type { EvidenceImage } from "@/lib/ai/types";
import { annotationSchema, documentSchema, type Annotation, type BenchDocument } from "./schema";

export function sha256Hex(bytes: Uint8Array | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function documentDir(dataDir: string, id: string): string {
  return path.join(dataDir, "documents", id);
}

export function documentFile(dataDir: string, id: string): string {
  return path.join(documentDir(dataDir, id), "document.json");
}

export function annotationFile(dataDir: string, task: string, id: string): string {
  return path.join(dataDir, "annotations", task, `${id}.json`);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadDocument(dataDir: string, id: string): BenchDocument {
  const file = documentFile(dataDir, id);
  const parsed = documentSchema.safeParse(readJson(file));
  if (!parsed.success) throw new Error(`document ${id}: ${describeIssues(parsed.error)}`);
  if (parsed.data.id !== id) {
    throw new Error(`document ${id}: the id inside document.json is ${parsed.data.id}`);
  }
  return parsed.data;
}

/** The ids of every document directory on disk, sorted. */
export function listDocumentIds(dataDir: string): string[] {
  const root = path.join(dataDir, "documents");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The ids of every annotation of `task` on disk, sorted. */
export function listAnnotationIds(dataDir: string, task: string): string[] {
  const root = path.join(dataDir, "annotations", task);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

export function loadAnnotation<T extends z.ZodType>(
  dataDir: string,
  task: string,
  id: string,
  expectSchema: T
): Annotation<z.infer<T>> {
  const parsed = annotationSchema(task, expectSchema).safeParse(
    readJson(annotationFile(dataDir, task, id))
  );
  if (!parsed.success) throw new Error(`annotation ${task}/${id}: ${describeIssues(parsed.error)}`);
  if (parsed.data.documentId !== id) {
    throw new Error(`annotation ${task}/${id}: documentId is ${parsed.data.documentId}`);
  }
  return parsed.data as Annotation<z.infer<T>>;
}

/**
 * The images of a document as the app hands them to the model: checked, and a tall screenshot cut
 * into overlapping parts, through the same preparation a stored image goes through. The app code is
 * imported here, not at the top, so that `run.ts` sets the log level before the logger loads and
 * the scripts that only read files never load sharp.
 */
export async function loadEvidenceImages(
  dataDir: string,
  document: BenchDocument
): Promise<EvidenceImage[]> {
  const [{ toEvidenceImage }, { prepareStoredImageForAI }] = await Promise.all([
    import("@/lib/ai/evidence-images"),
    import("@/lib/storage/image-processing"),
  ]);
  const images: EvidenceImage[] = [];
  for (const image of document.images) {
    const bytes = fs.readFileSync(
      path.join(documentDir(dataDir, document.id), "evidence", image.file)
    );
    images.push(toEvidenceImage(await prepareStoredImageForAI(bytes, image.contentType)));
  }
  return images;
}
