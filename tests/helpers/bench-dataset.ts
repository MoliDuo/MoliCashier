import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  annotationFile,
  documentDir,
  documentFile,
  sha256Hex,
} from "../../scripts/bench/lib/dataset";
import {
  SCHEMA_VERSION,
  type BenchDocument,
  type BenchLabels,
  type ParseExpect,
} from "../../scripts/bench/lib/schema";

export const FIXTURE_CATEGORIES = [
  { name: "Food", description: "Meals and drinks" },
  { name: "Transport", description: "Rides and fuel" },
];

export const GOLD_LABELS: BenchLabels = {
  status: "gold",
  rules: ["delivery-only"],
  provenance: "synthetic",
  humanCorrected: false,
};

/** A fresh directory outside any git repository, standing in for the private data directory. */
export function makeDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bench-data-"));
}

export function writeFixtureCase(
  dataDir: string,
  id: string,
  options: {
    text?: string;
    image?: Uint8Array;
    expect: ParseExpect;
    labels?: BenchLabels;
  }
): BenchDocument {
  const images: BenchDocument["images"] = [];
  fs.mkdirSync(path.join(documentDir(dataDir, id), "evidence"), { recursive: true });
  if (options.image != null) {
    fs.writeFileSync(path.join(documentDir(dataDir, id), "evidence", "1.png"), options.image);
    images.push({ file: "1.png", sha256: sha256Hex(options.image), contentType: "image/png" });
  }
  const document: BenchDocument = {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: "Example Cafe",
    text: options.text ?? "",
    images,
    ledger: {
      categories: FIXTURE_CATEGORIES,
      preferredCurrencies: ["CNY"],
      aiLanguage: "en",
      customPrompt: "",
    },
  };
  fs.writeFileSync(documentFile(dataDir, id), JSON.stringify(document));
  fs.mkdirSync(path.dirname(annotationFile(dataDir, "parse", id)), { recursive: true });
  fs.writeFileSync(
    annotationFile(dataDir, "parse", id),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      task: "parse",
      documentId: id,
      labels: options.labels ?? GOLD_LABELS,
      expect: options.expect,
    })
  );
  return document;
}
