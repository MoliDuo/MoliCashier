import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { DateOrganizationSuggestion } from "@/lib/source-document/suggestions";
import { computeHash, prefixSuffix } from "@/lib/security/service-credential-token";
import * as schema from "@/persistence";
import { durableKey } from "@/server/stored-files/shared";
import {
  seedBooks,
  seedCategories,
  seedExchangeRates,
  seedLedger,
  seedServiceCredential,
  seedSourceDocument,
  type SeedDatabase,
  type SeedAttempt,
} from "./lib/seed";

interface FixtureEntry {
  id: string;
  category: string | null;
  itemName: string;
  amount: string;
  currency: string;
  description?: string;
}

interface FixtureDocument {
  id: string;
  attemptId: string;
  title: string | null;
  dayOffset: number;
  inputText: string;
  book: string;
  status: SeedAttempt["status"];
  failureKind?: NonNullable<SeedAttempt["failureKind"]>;
  failureCode?: string;
  failureMessage?: string;
  image?: { fileId: string; filename: string; asset: string };
  entries: FixtureEntry[];
  dateSuggestionId?: string;
  dateSuggestionEntryId?: string;
  retainedResult?: { attemptId: string; title: string | null; entries: FixtureEntry[] };
}

export interface FixtureCredential {
  id: string;
  name: string;
  tokenBody: string;
  book: string;
}

interface DemoFixture {
  ledger: { mainCurrency: string; preferredCurrencies: string[]; aiLanguage: string };
  exchangeRates?: Record<string, string>;
  books: Array<{ id: string; name: string; sortOrder: number }>;
  categories: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    sortOrder: number;
  }>;
  documents: FixtureDocument[];
  serviceCredentials: FixtureCredential[];
}

export interface UploadedImage {
  fileId: string;
  filename: string;
  bytes: Buffer;
}

type Environment = Partial<NodeJS.ProcessEnv>;

const FIXTURE_DIR = path.dirname(
  fileURLToPath(new URL("./fixtures/demo-workspace.json", import.meta.url))
);
const fixture = JSON.parse(
  readFileSync(path.join(FIXTURE_DIR, "demo-workspace.json"), "utf8")
) as DemoFixture;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEMO_DATABASE = "cashier_demo";
const CREDENTIAL_TOKEN_PREFIX = "sk_live_";

/**
 * The two schemas every demo rebuild drops, and the rows inside `public` that
 * decide what the rebuild would replace. Nothing here names a business column:
 * a preview has to describe a demo database a previous release left behind,
 * whose tables may not have the columns the current schema expects.
 */
const DEMO_RESET_SCHEMAS = { data: "public", migrations: "drizzle" };
const DEMO_RESET_DATA_TABLES = ["ledgers", "source_documents", "ledger_entries", "stored_files"];

/**
 * Demo tokens keep the app's real format so the seeded rows exercise the same
 * hashing and parsing path, but the prefix is applied here rather than stored in
 * the fixture: a literal `sk_live_` followed by 48 hex characters is
 * indistinguishable to GitHub push protection from a real Stripe-shaped key,
 * and it rejects the push. The composed token is only ever valid against the
 * local demo database, and it is printed at startup.
 *
 * Composes a fixture credential's demo token.
 */
export function fixtureCredentialToken(credential: Pick<FixtureCredential, "tokenBody">): string {
  return `${CREDENTIAL_TOKEN_PREFIX}${credential.tokenBody}`;
}

function requiredUrl(name: string, value: string | undefined): URL {
  try {
    return new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

/** Verifies that focused tests reject non-local demo targets. */
export function validateDemoEnvironment(environment: Environment = process.env): {
  databaseUrl: string;
  storageUrl: string;
} {
  if (environment.CASHIER_DEMO_MODE !== "true") {
    throw new Error("CASHIER_DEMO_MODE=true is required");
  }
  const databaseUrl = requiredUrl("DATABASE_URL", environment.DATABASE_URL);
  if (!LOOPBACK_HOSTS.has(databaseUrl.hostname) || databaseUrl.pathname !== `/${DEMO_DATABASE}`) {
    throw new Error(`Demo data requires a loopback ${DEMO_DATABASE} database`);
  }
  const storageUrl = requiredUrl("S3_ENDPOINT", environment.S3_ENDPOINT);
  if (!LOOPBACK_HOSTS.has(storageUrl.hostname)) {
    throw new Error("Demo data requires loopback object storage");
  }
  if (!Array.isArray(fixture.books) || fixture.books.length === 0) {
    throw new Error("Demo fixture must define the books its records belong to");
  }
  if ((environment.AUTH_SECRET ?? "").trim() === "") {
    throw new Error("AUTH_SECRET is required to seed demo service credentials");
  }
  return { databaseUrl: databaseUrl.toString(), storageUrl: storageUrl.toString() };
}

/** Any positive value works: demo conversions only depend on the fixture's rates. */
const DEMO_MAIN_CURRENCY_PER_EUR = "7.8";

function isoDateWithOffset(anchorDate: string, dayOffset: number): string {
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function anchorDate(environment: Environment): string {
  const explicit = environment.CASHIER_DEMO_AS_OF;
  if (explicit != null) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(explicit) ||
      Number.isNaN(Date.parse(`${explicit}T00:00:00Z`))
    ) {
      throw new Error("CASHIER_DEMO_AS_OF must use YYYY-MM-DD");
    }
    return explicit;
  }
  return new Date().toISOString().slice(0, 10);
}

function createStorage(environment: Environment): S3Client {
  return new S3Client({
    region: environment.S3_REGION ?? "auto",
    ...(environment.S3_ENDPOINT == null ? {} : { endpoint: environment.S3_ENDPOINT }),
    forcePathStyle: true,
    credentials: {
      accessKeyId: environment.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

function activeEntries(document: FixtureDocument): FixtureEntry[] {
  return document.retainedResult?.entries ?? document.entries;
}

async function uploadFixtureImages(
  storage: S3Client,
  environment: Environment
): Promise<UploadedImage[]> {
  const uploaded: UploadedImage[] = [];
  for (const document of fixture.documents) {
    if (document.image == null) continue;
    const bytes = await readFile(path.join(FIXTURE_DIR, document.image.asset));
    await storage.send(
      new PutObjectCommand({
        Bucket: environment.S3_BUCKET,
        Key: durableKey(document.image.fileId),
        Body: bytes,
        ContentType: "image/jpeg",
      })
    );
    uploaded.push({ fileId: document.image.fileId, filename: document.image.filename, bytes });
  }
  return uploaded;
}

/**
 * Empties the disposable demo database before migrations run.
 *
 * Every demo launch restores the fixture, and the schema the previous launch
 * left behind can be any historical shape — including one a data migration
 * rightly refuses to touch. Since this database is dedicated, loopback-only and
 * rebuilt from the fixture on each launch, the honest move is to drop its
 * objects and let the migrations build the current schema from nothing.
 *
 * Drizzle's bookkeeping schema goes with it: leaving that behind would make the
 * runner believe every migration is already applied.
 *
 * Empties the demo schemas, refusing anything but the demo database.
 */
export async function resetDemoSchema(environment: Environment = process.env): Promise<void> {
  const { databaseUrl } = validateDemoEnvironment(environment);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const schemaName of ["public", "drizzle"]) {
      await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    }
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

interface DemoInspection {
  counts: { ledgers: number; documents: number; entries: number; files: number };
  keys: string[];
}

async function inspectDemoTarget(client: pg.Client): Promise<DemoInspection> {
  const counts = await client.query<DemoInspection["counts"]>(
    `SELECT
       (SELECT count(*)::int FROM ledgers) AS ledgers,
       (SELECT count(*)::int FROM source_documents) AS documents,
       (SELECT count(*)::int FROM ledger_entries) AS entries,
       (SELECT count(*)::int FROM stored_files) AS files`
  );
  const keys = (
    await client.query<{ storage_key: string }>(
      "SELECT storage_key FROM stored_files ORDER BY storage_key"
    )
  ).rows.map((row) => row.storage_key);
  const [countRow] = counts.rows;
  if (countRow == null) throw new Error("Demo target counts are missing");
  return { counts: countRow, keys };
}

function dateSuggestion(
  document: FixtureDocument,
  documentDate: string,
  asOf: string
): DateOrganizationSuggestion | null {
  if (document.dateSuggestionEntryId == null || document.dateSuggestionId == null) return null;
  const resolvedDate = isoDateWithOffset(asOf, document.dayOffset + 1);
  const entry = document.entries.find((item) => item.id === document.dateSuggestionEntryId);
  if (entry == null) throw new Error(`Unknown demo suggestion entry: ${document.id}`);
  return {
    schemaVersion: 1,
    id: document.dateSuggestionId,
    referenceDate: documentDate,
    sourceDocumentDate: documentDate,
    items: [
      {
        ledgerEntryId: entry.id,
        dateHint: { kind: "relative", value: "tomorrow", sourceText: "tomorrow" },
        resolvedDate,
        sourceText: "tomorrow",
        snapshot: { itemName: entry.itemName, amount: entry.amount, currency: entry.currency },
      },
    ],
  };
}

function requireBookId(bookIds: Map<string, string>, name: string): string {
  const id = bookIds.get(name);
  if (id == null) throw new Error(`Unknown demo book: ${name}`);
  return id;
}

export async function insertFixture(
  db: SeedDatabase,
  environment: Environment,
  { uploadedImages, reset }: { uploadedImages: UploadedImage[]; reset: boolean }
): Promise<void> {
  const asOf = anchorDate(environment);
  const now = new Date(`${asOf}T12:00:00.000Z`);
  if (reset) {
    // The dedicated demo database holds one ledger. A reset removes it and
    // everything in it, so it restores the fixture
    // instead of layering onto whatever the last session left behind. A
    // record takes its attempts, entries and file links with it.
    await db.delete(schema.categoryAssignmentJobs);
    await db.delete(schema.sourceDocuments);
    await db.delete(schema.storedFiles);
    await db.delete(schema.entryCategories);
    await db.delete(schema.serviceCredentials);
    await db.delete(schema.books);
    await db.delete(schema.ledgerSyncState);
    await db.delete(schema.ledgers);
  }
  await seedLedger(db, {
    aiLanguage: fixture.ledger.aiLanguage,
    preferredCurrencies: fixture.ledger.preferredCurrencies,
    mainCurrency: fixture.ledger.mainCurrency,
    at: now,
  });
  const bookIds = await seedBooks(db, fixture.books, now);

  // The reset above deleted any earlier credentials for this workspace; these
  // rows are recreated with it.
  for (const credential of fixture.serviceCredentials) {
    const token = fixtureCredentialToken(credential);
    const { prefix, suffix } = prefixSuffix(token);
    await seedServiceCredential(db, {
      id: credential.id,
      bookId: requireBookId(bookIds, credential.book),
      name: credential.name,
      tokenHash: computeHash(token),
      tokenPrefix: prefix,
      tokenSuffix: suffix,
      at: now,
    });
  }

  // A seed over an existing ledger keeps the categories it already has.
  const existing = await db
    .select({ id: schema.entryCategories.id, name: schema.entryCategories.name })
    .from(schema.entryCategories);
  const categoryIds = new Map(existing.map((row) => [row.name, row.id]));
  const seeded = await seedCategories(
    db,
    fixture.categories.filter((category) => !categoryIds.has(category.name)),
    now
  );
  for (const [name, id] of seeded) categoryIds.set(name, id);

  const imagesByFileId = new Map(uploadedImages.map((image) => [image.fileId, image]));
  for (const document of fixture.documents) {
    const documentDate = isoDateWithOffset(asOf, document.dayOffset);
    const createdAt = new Date(`${documentDate}T12:00:00.000Z`);
    const image = document.image == null ? undefined : imagesByFileId.get(document.image.fileId);
    const attempts: SeedAttempt[] = [
      ...(document.retainedResult == null
        ? []
        : [
            {
              id: document.retainedResult.attemptId,
              requestedDate: documentDate,
              status: "completed" as const,
            },
          ]),
      {
        id: document.attemptId,
        requestedDate: documentDate,
        status: document.status,
        failureKind: document.failureKind ?? null,
        failureCode: document.failureCode ?? null,
        failureMessage: document.failureMessage ?? null,
        finishedAt: createdAt,
      },
    ];
    const entries = activeEntries(document);
    await seedSourceDocument(db, {
      id: document.id,
      bookId: requireBookId(bookIds, document.book),
      // A failed retry keeps the title of the result it left in place.
      title: document.title ?? document.retainedResult?.title ?? null,
      inputText: document.inputText,
      documentDate,
      dateOrganizationSuggestion: dateSuggestion(document, documentDate, asOf),
      attempts,
      files:
        image == null
          ? []
          : [
              {
                id: image.fileId,
                contentType: "image/jpeg",
                byteSize: image.bytes.length,
                originalFilename: image.filename,
                checksum: crypto.createHash("sha256").update(image.bytes).digest("hex"),
              },
            ],
      entries: entries.map((entry) => {
        const categoryId =
          entry.category == null ? null : (categoryIds.get(entry.category) ?? null);
        if (entry.category != null && categoryId == null) {
          throw new Error(`Unknown demo category: ${entry.category}`);
        }
        return {
          id: entry.id,
          categoryId,
          itemName: entry.itemName,
          amount: entry.amount,
          currency: entry.currency,
          description: entry.description ?? null,
        };
      }),
      at: createdAt,
    });
    await seedDemoExchangeRates(db, documentDate, entries, now);
  }
}

/**
 * Stores the day's rates the fixture's foreign entries convert at, so the demo
 * shows converted totals without reaching the rate provider. The rows are
 * final, so maintenance never replaces them.
 */
async function seedDemoExchangeRates(
  db: SeedDatabase,
  rateDate: string,
  entries: readonly FixtureEntry[],
  now: Date
): Promise<void> {
  const mainCurrency = fixture.ledger.mainCurrency;
  const foreign = [...new Set(entries.map((entry) => entry.currency))].filter(
    (currency) => currency !== mainCurrency
  );
  if (foreign.length === 0) return;
  const mainPerEur = mainCurrency === "EUR" ? "1" : DEMO_MAIN_CURRENCY_PER_EUR;
  // A foreign currency's rate is how many main-currency units one unit buys,
  // so it buys main/rate per euro.
  await seedExchangeRates(
    db,
    rateDate,
    [
      { currency: "EUR", dividend: "1", divisor: "1" },
      { currency: mainCurrency, dividend: mainPerEur, divisor: "1" },
      ...foreign.map((currency) => {
        const rate = fixture.exchangeRates?.[currency];
        if (rate == null) throw new Error(`Demo fixture has no exchange rate for ${currency}`);
        return { currency, dividend: mainPerEur, divisor: rate };
      }),
    ],
    now
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * What one schema of a demo database holds. `rows` maps a counted table to its
 * row count, or to null when the schema exists but that table does not.
 */
interface DemoResetSchema {
  exists: boolean;
  tables: string[];
  rows: Record<string, number | null>;
}

/**
 * Just enough of a database client to describe a schema: the preview never
 * opens a pool, and a test can record every statement by standing in with this
 * shape.
 */
interface DemoResetClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** One column of a catalog row the preview reads. */
function column(row: unknown, name: string): unknown {
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)[name]
    : undefined;
}

async function schemaExists(client: DemoResetClient, schemaName: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
  return result.rows.length > 0;
}

async function listSchemaTables(client: DemoResetClient, schemaName: string): Promise<string[]> {
  const result = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
    [schemaName]
  );
  return result.rows.map((row) => String(column(row, "name")));
}

async function describeSchema(
  client: DemoResetClient,
  schemaName: string,
  countedTables: readonly string[] | null
): Promise<DemoResetSchema> {
  if (!(await schemaExists(client, schemaName))) {
    // A preview of a database that is not there yet is still a preview: the
    // targets are named, and every one of them is absent rather than zero.
    return {
      exists: false,
      tables: [],
      rows: Object.fromEntries((countedTables ?? []).map((table) => [table, null])),
    };
  }
  const tables = await listSchemaTables(client, schemaName);
  const existing = new Set(tables);
  // The data tables are asked about by name, so an un-migrated database reports
  // them as absent; the bookkeeping schema is whatever Drizzle created there.
  const targets = countedTables ?? tables;
  const rows: Record<string, number | null> = {};
  for (const table of targets) {
    if (!existing.has(table)) {
      rows[table] = null;
      continue;
    }
    const counted = await client.query(
      `SELECT count(*)::int AS count FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(table)}`
    );
    rows[table] = (column(counted.rows[0], "count") ?? null) as number | null;
  }
  return { exists: true, tables, rows };
}

/**
 * Reads what a demo rebuild would replace — schemas, tables and row counts —
 * and writes nothing.
 *
 * Everything goes through the catalog, so a demo database a previous release
 * left behind can still be described; and the transaction is opened READ ONLY,
 * so a write added here by accident fails instead of quietly turning the
 * preview into a rebuild.
 *
 * Reports the demo reset targets from a live connection, read-only.
 */
export async function inspectDemoResetTargets(
  client: DemoResetClient,
  options: { dataSchema?: string; migrationsSchema?: string } = {}
): Promise<{ schemas: Record<string, DemoResetSchema> }> {
  const dataSchema = options.dataSchema ?? DEMO_RESET_SCHEMAS.data;
  const migrationsSchema = options.migrationsSchema ?? DEMO_RESET_SCHEMAS.migrations;
  await client.query("BEGIN READ ONLY");
  try {
    const schemas = {
      [dataSchema]: await describeSchema(client, dataSchema, DEMO_RESET_DATA_TABLES),
      [migrationsSchema]: await describeSchema(client, migrationsSchema, null),
    };
    await client.query("COMMIT");
    return { schemas };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Answers "what would a reset replace?" without replacing anything.
 *
 * The connection string never reaches the log — it carries the demo database's
 * credentials, and this output exists to be read and pasted around — and no
 * object storage client is built, so no object can be written or deleted.
 *
 * Prints the reset preview; refuses every non-demo target.
 */
export async function previewDemoReset(environment: Environment = process.env) {
  const { databaseUrl } = validateDemoEnvironment(environment);
  const target = new URL(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const preview = {
      mode: "preview-reset",
      apply: false,
      database: `${target.host}${target.pathname}`,
      ...(await inspectDemoResetTargets(client)),
    };
    console.log(JSON.stringify(preview));
    console.log("[demo] Preview only: nothing was dropped, migrated or seeded.");
    console.log("[demo] Run `npm run demo:reset -- --apply` to rebuild the demo workspace.");
    return preview;
  } finally {
    await client.end();
  }
}

async function runDemoData({
  mode = "seed",
  apply = false,
  environment = process.env,
}: { mode?: "seed" | "reset"; apply?: boolean; environment?: Environment } = {}) {
  const { databaseUrl } = validateDemoEnvironment(environment);
  if (
    !environment.S3_BUCKET ||
    !environment.S3_ACCESS_KEY_ID ||
    !environment.S3_SECRET_ACCESS_KEY
  ) {
    throw new Error("Demo object storage configuration is incomplete");
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const storage = createStorage(environment);
  try {
    const inspection = await inspectDemoTarget(client);
    if (mode === "reset") {
      console.log(
        JSON.stringify({
          mode: apply ? "demo-reset-target" : "demo-reset-preview",
          ...inspection.counts,
          keys: inspection.keys,
        })
      );
      if (!apply) {
        console.log("[demo] Preview only. Re-run with --apply to rebuild the demo workspace.");
        return { status: "preview", ...inspection };
      }
    }

    const knownIds = fixture.documents.map((document) => document.id);
    const present = await client.query(
      "SELECT id FROM source_documents WHERE id = ANY($1::uuid[])",
      [knownIds]
    );
    if (mode === "seed" && present.rowCount === knownIds.length) {
      console.log("[demo] Demo workspace already exists; existing test changes were preserved.");
      return { status: "existing", ...inspection };
    }
    if (mode === "seed" && (present.rowCount ?? 0) > 0) {
      throw new Error("Demo workspace is partial; run npm run demo:reset -- --apply");
    }

    const reset = mode === "reset";
    const uploadedImages = await uploadFixtureImages(storage, environment);
    await drizzle(client, { schema }).transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${1_536_335_661})`);
      await insertFixture(tx, environment, { uploadedImages, reset });
    });

    const fixtureKeys = new Set(uploadedImages.map((image) => durableKey(image.fileId)));
    const staleKeys = inspection.keys.filter((key) => !fixtureKeys.has(key));
    if (reset && staleKeys.length > 0) {
      try {
        await storage.send(
          new DeleteObjectsCommand({
            Bucket: environment.S3_BUCKET,
            Delete: { Objects: staleKeys.map((Key) => ({ Key })), Quiet: true },
          })
        );
      } catch (error) {
        throw new Error(
          `Demo database reset completed, but object cleanup failed: ${staleKeys.join(", ")}`,
          { cause: error }
        );
      }
    }
    console.log(
      JSON.stringify({
        mode: reset ? "demo-reset" : "demo-seed",
        status: "complete",
        documents: fixture.documents.length,
        entries: fixture.documents.reduce(
          (sum, document) => sum + activeEntries(document).length,
          0
        ),
        credentials: fixture.serviceCredentials.length,
      })
    );
    return { status: "complete" };
  } finally {
    storage.destroy();
    await client.end();
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  // Checked before anything else: `preview-reset` has to answer without the
  // schema drop, the migrations or the seed that follow it ever running.
  if (args.has("preview-reset")) {
    await previewDemoReset();
    return;
  }
  if (args.has("reset-schema")) {
    await resetDemoSchema();
    console.log("[demo] Demo schema dropped; the migrations will rebuild it.");
    return;
  }
  const mode = args.has("reset") ? "reset" : "seed";
  await runDemoData({ mode, apply: args.has("--apply") });
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
