/**
 * One-off: moves the gold set out of the old promptfoo project into the
 * benchmark's own data layout.
 *
 *   CASHIER_BENCH_DATA_DIR=/path/to/data npm run bench:migrate -- --from /path/to/cashier-promptfoo
 *
 * Only cases tagged `benchmark` come across, as `status: gold`; `gt-corrected` becomes
 * `humanCorrected`. The other old tags (`approved`, `invalid`, `error`) mixed review state with
 * symptoms and do not map to anything, so they are counted in the report and dropped. Production
 * identifiers do not survive: a document's new id is derived from the old one by hashing. The
 * source directory is only read.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnvironment } from "../load-local-environment";
import { resolveDataDir } from "./lib/data-dir";
import { sha256Hex, annotationFile, documentDir, documentFile } from "./lib/dataset";
import {
  SCHEMA_VERSION,
  annotationSchema,
  documentSchema,
  parseExpectSchema,
  type BenchDocument,
} from "./lib/schema";

const legacyCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  document_text: z.string(),
  ai_language: z.string(),
  preferred_currencies: z.array(z.string()),
  custom_prompt: z.string(),
  truth: z.object({
    outcome: z.enum(["success", "invalid"]),
    categories: z.array(z.object({ name: z.string(), description: z.string() })),
    items: z.array(
      z.object({
        item_name: z.string(),
        amount: z.string(),
        currency: z.string(),
        category: z.string(),
        notes: z.string().optional(),
      })
    ),
  }),
  images: z.array(
    z.object({ sha256: z.string(), relative_path: z.string(), content_type: z.string() })
  ),
  tags: z.array(z.string()),
});

/** What the old pull script wrote for an entry whose category was gone. */
const LEGACY_NO_CATEGORY = "Uncategorized";

function newDocumentId(legacyId: string): string {
  return `doc-${sha256Hex(legacyId).slice(0, 12)}`;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function main(): void {
  const { values } = parseArgs({ options: { from: { type: "string" } } });
  if (values.from == null)
    throw new Error("usage: migrate-promptfoo.ts --from <promptfoo project>");
  const source = path.resolve(values.from, "data");
  loadLocalEnvironment();
  const dataDir = resolveDataDir();
  fs.chmodSync(dataDir, 0o700);

  for (const existing of ["documents", "annotations"]) {
    if (fs.existsSync(path.join(dataDir, existing))) {
      throw new Error(
        `${existing}/ already exists in the data directory; refusing to migrate over it`
      );
    }
  }

  // Everything is written beside the final location and moved in only when the whole set is done,
  // so a failure leaves no half-migrated data behind.
  const staging = fs.mkdtempSync(path.join(dataDir, ".migrating-"));
  try {
    migrate(source, staging);
    fs.renameSync(path.join(staging, "documents"), path.join(dataDir, "documents"));
    fs.renameSync(path.join(staging, "annotations"), path.join(dataDir, "annotations"));
    fs.renameSync(
      path.join(staging, "migration-report.json"),
      path.join(dataDir, "migration-report.json")
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  console.log("next: npm run bench:data -- manifest");
}

function migrate(source: string, staging: string): void {
  const files = fs
    .readdirSync(path.join(source, "cases"))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const droppedTags = new Map<string, number>();
  const idMap: Record<string, string> = {};
  let migrated = 0;
  let skipped = 0;

  for (const name of files) {
    const legacy = legacyCaseSchema.parse(
      JSON.parse(fs.readFileSync(path.join(source, "cases", name), "utf8"))
    );
    if (!legacy.tags.includes("benchmark")) {
      skipped += 1;
      continue;
    }
    for (const tag of legacy.tags) {
      if (tag !== "benchmark" && tag !== "gt-corrected") {
        droppedTags.set(tag, (droppedTags.get(tag) ?? 0) + 1);
      }
    }

    const id = newDocumentId(legacy.id);
    if (id in idMap || Object.values(idMap).includes(id)) throw new Error("document id collision");
    idMap[legacy.id] = id;

    const images = legacy.images.map((image, index) => {
      const bytes = fs.readFileSync(path.join(source, image.relative_path));
      if (sha256Hex(bytes) !== image.sha256) {
        throw new Error(`image ${image.relative_path} does not match its recorded checksum`);
      }
      const extension = path.extname(image.relative_path) || ".bin";
      const file = `${index + 1}${extension}`;
      fs.mkdirSync(path.join(documentDir(staging, id), "evidence"), { recursive: true });
      fs.writeFileSync(path.join(documentDir(staging, id), "evidence", file), bytes, {
        flag: "wx",
      });
      return { file, sha256: image.sha256, contentType: image.content_type };
    });

    const document: BenchDocument = documentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id,
      title: legacy.title,
      text: legacy.document_text,
      images,
      ledger: {
        categories: legacy.truth.categories,
        preferredCurrencies: legacy.preferred_currencies,
        aiLanguage: legacy.ai_language,
        customPrompt: legacy.custom_prompt,
      },
    });
    writeJson(documentFile(staging, id), document);

    writeJson(
      annotationFile(staging, "parse", id),
      annotationSchema("parse", parseExpectSchema).parse({
        schemaVersion: SCHEMA_VERSION,
        task: "parse",
        documentId: id,
        labels: {
          status: "gold",
          rules: [],
          provenance: "production",
          humanCorrected: legacy.tags.includes("gt-corrected"),
        },
        expect: {
          outcome: legacy.truth.outcome,
          entries: legacy.truth.items.map((item) => ({
            itemName: item.item_name,
            amount: item.amount,
            currency: item.currency,
            category: item.category === LEGACY_NO_CATEGORY ? null : item.category,
          })),
        },
      })
    );
    migrated += 1;
  }

  // The id map is the only link back to production identifiers, so it stays in the private directory.
  writeJson(path.join(staging, "migration-report.json"), {
    migratedAt: new Date().toISOString(),
    migrated,
    skippedWithoutBenchmarkTag: skipped,
    droppedTags: Object.fromEntries(droppedTags),
    legacyIdToDocumentId: idMap,
  });
  console.log(
    `migrated ${migrated} cases (skipped ${skipped} without the benchmark tag); dropped tags: ` +
      `${[...droppedTags].map(([tag, count]) => `${tag}×${count}`).join(", ") || "none"}`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
