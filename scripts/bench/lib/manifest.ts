/**
 * The committed manifest: hashes, not content.
 *
 * The data itself is private, so the repository records only what it should
 * look like. A document's hash covers `document.json`, which names every image
 * with its own hash, so one entry pins the whole input; an annotation's hash
 * pins its expected answer. A run verifies the cases it loads against this, and
 * a score can always be traced to the exact data that produced it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotationFile,
  documentDir,
  documentFile,
  listAnnotationIds,
  listDocumentIds,
  loadDocument,
  sha256Hex,
} from "./dataset";
import { manifestSchema, SCHEMA_VERSION, type Manifest } from "./schema";

export const MANIFEST_PATH = fileURLToPath(new URL("../manifest.json", import.meta.url));

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** The annotation tasks that have a directory under `annotations/`. */
function listTasks(dataDir: string): string[] {
  const root = path.join(dataDir, "annotations");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function buildManifest(dataDir: string): Manifest {
  const documents: Record<string, string> = {};
  for (const id of listDocumentIds(dataDir)) {
    documents[id] = sha256Hex(fs.readFileSync(documentFile(dataDir, id)));
  }
  const annotations: Record<string, Record<string, string>> = {};
  for (const task of listTasks(dataDir)) {
    annotations[task] = Object.fromEntries(
      listAnnotationIds(dataDir, task).map((id) => [
        id,
        sha256Hex(fs.readFileSync(annotationFile(dataDir, task, id))),
      ])
    );
  }
  return { schemaVersion: SCHEMA_VERSION, documents, annotations: sortedRecord(annotations) };
}

export function readManifest(file: string = MANIFEST_PATH): Manifest {
  return manifestSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeManifest(manifest: Manifest, file: string = MANIFEST_PATH): void {
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

export interface VerifyScope {
  /** Only these documents are checked for being absent from the manifest. */
  documentIds?: readonly string[];
  /** Only these (task, document) annotation pairs. Defaults to every annotation on disk. */
  annotations?: readonly { task: string; id: string }[];
}

export interface VerifyReport {
  errors: string[];
  warnings: string[];
}

/** Hash order matters little; what matters is that every difference is named. */
export function verifyAgainstManifest(
  dataDir: string,
  manifest: Manifest,
  scope: VerifyScope = {}
): VerifyReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const documentIds = scope.documentIds ?? listDocumentIds(dataDir);
  for (const id of documentIds) {
    const expected = manifest.documents[id];
    if (!fs.existsSync(documentFile(dataDir, id))) {
      errors.push(`document ${id}: document.json is missing`);
      continue;
    }
    const actual = sha256Hex(fs.readFileSync(documentFile(dataDir, id)));
    if (expected == null) warnings.push(`document ${id}: not in the manifest`);
    else if (expected !== actual)
      errors.push(`document ${id}: document.json does not match the manifest`);

    const document = loadDocument(dataDir, id);
    for (const image of document.images) {
      const imagePath = path.join(documentDir(dataDir, id), "evidence", image.file);
      if (!fs.existsSync(imagePath)) {
        errors.push(`document ${id}: evidence/${image.file} is missing`);
      } else if (sha256Hex(fs.readFileSync(imagePath)) !== image.sha256) {
        errors.push(`document ${id}: evidence/${image.file} does not match its recorded hash`);
      }
    }
  }

  const pairs =
    scope.annotations ??
    listTasks(dataDir).flatMap((task) =>
      listAnnotationIds(dataDir, task).map((id) => ({ task, id }))
    );
  for (const { task, id } of pairs) {
    const expected = manifest.annotations[task]?.[id];
    const file = annotationFile(dataDir, task, id);
    if (!fs.existsSync(file)) {
      errors.push(`annotation ${task}/${id}: file is missing`);
      continue;
    }
    const actual = sha256Hex(fs.readFileSync(file));
    if (expected == null) warnings.push(`annotation ${task}/${id}: not in the manifest`);
    else if (expected !== actual)
      errors.push(`annotation ${task}/${id}: does not match the manifest`);
  }

  // Everything the manifest promises must still exist, whatever the scope.
  if (scope.documentIds == null && scope.annotations == null) {
    for (const id of Object.keys(manifest.documents)) {
      if (!fs.existsSync(documentFile(dataDir, id))) {
        errors.push(`document ${id}: listed in the manifest but missing`);
      }
    }
    for (const [task, entries] of Object.entries(manifest.annotations)) {
      for (const id of Object.keys(entries)) {
        if (!fs.existsSync(annotationFile(dataDir, task, id))) {
          errors.push(`annotation ${task}/${id}: listed in the manifest but missing`);
        }
      }
    }
  }
  return { errors, warnings };
}
