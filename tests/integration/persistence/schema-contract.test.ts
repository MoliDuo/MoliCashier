import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, getTestPool } from "tests/setup";
import { createTestLedger, createTestSourceDocument } from "tests/helpers/schema-setup";
import {
  extractionAttempts,
  ledgerSyncState,
  ledgers,
  sessions,
  sourceDocuments,
} from "@/persistence";
import * as schema from "@/persistence";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";

interface ConstraintRow {
  conname: string;
  definition: string;
  type: "c" | "f" | "p" | "u";
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

interface TriggerRow {
  tgname: string;
}

interface ColumnRow {
  columnName: string;
  isGenerated: string;
  generationExpression: string | null;
}

async function fetchConstraints(): Promise<ConstraintRow[]> {
  const result = await getTestDb().execute<ConstraintRow & Record<string, unknown>>(sql`
    SELECT con.conname, con.contype AS type, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND con.contype IN ('c', 'f', 'p', 'u')
    ORDER BY con.conname
  `);
  return result.rows;
}

async function fetchIndexes(): Promise<IndexRow[]> {
  const result = await getTestDb().execute<IndexRow & Record<string, unknown>>(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
    ORDER BY indexname
  `);
  return result.rows;
}

function isPgTable(value: unknown): value is AnyPgTable {
  return (
    typeof value === "object" &&
    value != null &&
    Symbol.for("drizzle:Name") in value &&
    Symbol.for("drizzle:Columns") in value
  );
}

/**
 * Names the database still has but the model no longer mentions: a column, constraint or index the
 * code stopped using in this release, dropped by a migration in the next one (expand/contract,
 * docs/architecture.md §2.8). Columns are written `table.column`. Remove an entry in the same change
 * as the migration that drops it.
 */
const retiredNames = new Set<string>([
  // Watermarks the triggers still keep but nothing reads; the next release drops them.
  "ledger_sync_state.categories_version",
  "ledger_sync_state.settings_version",
  "ledger_sync_state.stats_version",
]);

function getDrizzleColumnNames(): Set<string> {
  const columns = new Set<string>();
  for (const table of Object.values(schema).filter(isPgTable) as AnyPgTable[]) {
    const config = getTableConfig(table);
    for (const column of config.columns) columns.add(`${config.name}.${column.name}`);
  }
  return columns;
}

async function fetchAllColumnNames(): Promise<Set<string>> {
  const result = await getTestDb().execute<{ name: string } & Record<string, unknown>>(sql`
    SELECT columns.table_name || '.' || columns.column_name AS name
    FROM information_schema.columns columns
    JOIN information_schema.tables tables
      ON tables.table_schema = columns.table_schema AND tables.table_name = columns.table_name
    WHERE columns.table_schema = current_schema()
      AND tables.table_type = 'BASE TABLE'
      AND columns.table_name NOT LIKE '\\_\\_drizzle%'
  `);
  return new Set(result.rows.map((row) => row.name));
}

function getDrizzleContractNames() {
  const constraints = new Set<string>();
  const indexes = new Set<string>();

  const tables = Object.values(schema).filter(isPgTable) as AnyPgTable[];
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) constraints.add(foreignKey.getName());
    for (const check of config.checks) constraints.add(check.name);
    for (const uniqueConstraint of config.uniqueConstraints) {
      if (uniqueConstraint.name != null) constraints.add(uniqueConstraint.name);
    }
    for (const column of config.columns) {
      if (column.isUnique && column.uniqueName != null) constraints.add(column.uniqueName);
    }
    for (const tableIndex of config.indexes) {
      if (tableIndex.config.name != null) indexes.add(tableIndex.config.name);
    }
  }

  return { constraints, indexes };
}

async function fetchTriggers(): Promise<TriggerRow[]> {
  const result = await getTestDb().execute<TriggerRow & Record<string, unknown>>(sql`
    SELECT trigger.tgname
    FROM pg_trigger trigger
    JOIN pg_class cls ON cls.oid = trigger.tgrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND NOT trigger.tgname LIKE 'pg\\_%'
    ORDER BY trigger.tgname
  `);
  return result.rows;
}

async function fetchColumns(tableName: string): Promise<ColumnRow[]> {
  const result = await getTestDb().execute<ColumnRow & Record<string, unknown>>(sql`
    SELECT column_name AS "columnName",
      is_generated AS "isGenerated",
      generation_expression AS "generationExpression"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${tableName}
    ORDER BY ordinal_position
  `);
  return result.rows;
}

describe("PostgreSQL schema contract", () => {
  const compact = (definition: string | undefined) => definition?.replace(/[\s()]/g, "") ?? "";

  it("keeps every foreign key between the ledger's tables", async () => {
    const byName = new Map((await fetchConstraints()).map((row) => [row.conname, row.definition]));
    const expected = [
      "fk_ledger_entries_source_document",
      "fk_ledger_entries_category",
      "fk_source_document_files_source_document",
      "fk_source_document_files_stored_file",
      "fk_source_documents_latest_attempt",
      "fk_extraction_attempts_source_document",
    ];
    for (const name of expected) {
      expect(byName.has(name), `missing foreign key ${name}`).toBe(true);
    }

    expect(byName.get("fk_ledger_entries_category")).toBe(
      "FOREIGN KEY (category_id) REFERENCES entry_categories(id) ON DELETE SET NULL"
    );
    expect(byName.get("fk_source_documents_latest_attempt")).toBe(
      "FOREIGN KEY (id, latest_attempt_id) REFERENCES extraction_attempts(source_document_id, id)"
    );
    expect(byName.has("ledger_entries_category_id_entry_categories_id_fk")).toBe(false);
  });

  it("keeps a record's latest attempt among its own attempts", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const first = await createTestSourceDocument(db);
    const second = await createTestSourceDocument(db);
    const [otherAttempt] = await db
      .select({ id: extractionAttempts.id })
      .from(extractionAttempts)
      .where(sql`${extractionAttempts.sourceDocumentId} = ${second}`);

    await expect(
      db
        .update(sourceDocuments)
        .set({ latestAttemptId: otherAttempt!.id })
        .where(sql`${sourceDocuments.id} = ${first}`)
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "23503",
        constraint: "fk_source_documents_latest_attempt",
      }),
    });
  });

  it("keeps sync version guards", async () => {
    const byName = new Map((await fetchConstraints()).map((row) => [row.conname, row.definition]));

    expect(compact(byName.get("ck_ledger_sync_state_version"))).toContain("version>=0");
    expect(byName.has("ledger_change_batches_version_check")).toBe(false);
  });

  it("removes status triggers while keeping change-log triggers", async () => {
    const names = new Set((await fetchTriggers()).map((row) => row.tgname));
    for (const name of [
      "trg_source_documents_refresh_status",
      "trg_revisions_refresh_document_status",
    ]) {
      expect(names.has(name), `unexpected trigger ${name}`).toBe(false);
    }
    for (const name of [
      "trg_source_documents_change_log",
      "trg_extraction_attempts_change_log",
      "trg_ledger_entries_change_log",
      "trg_entry_categories_change_log",
      "trg_ledgers_settings_change_log",
      "trg_books_change_log",
      "trg_service_credentials_change_log",
    ]) {
      expect(names.has(name), `missing trigger ${name}`).toBe(true);
    }
  });

  it("keeps only aggregate ledger change-log state", async () => {
    expect(await fetchColumns("ledger_change_batches")).toEqual([]);
    const columns = (await fetchColumns("ledger_sync_state")).map((column) => column.columnName);
    expect(columns).toEqual(
      expect.arrayContaining([
        "version",
        "transaction_id",
        "categories_version",
        "settings_version",
        "stats_version",
      ])
    );
    expect(await fetchColumns("ledger_change_items")).toEqual([]);
  });

  it("keeps a single change-log row", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    await createTestSourceDocument(db);
    await expect(db.insert(ledgerSyncState).values({})).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23505", constraint: "ledger_sync_state_pkey" }),
    });
    await expect(db.insert(ledgerSyncState).values({ id: false })).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "23514",
        constraint: "ck_ledger_sync_state_singleton",
      }),
    });
  });

  it("keeps the key indexes and tenant unique keys", async () => {
    const byName = new Map((await fetchIndexes()).map((row) => [row.indexname, row.indexdef]));
    for (const name of [
      "idx_ledger_entries_document_position",
      "idx_source_documents_feed",
      "idx_source_documents_book_feed",
      "idx_source_documents_created",
      "idx_extraction_attempts_due",
      "idx_ledger_entries_category",
      "idx_ledger_entries_search",
    ]) {
      expect(byName.has(name), `missing index ${name}`).toBe(true);
    }
    expect(byName.get("idx_source_documents_feed")).toContain("(document_date DESC");
    expect(byName.get("idx_source_documents_book_feed")).toContain("(book_id, document_date DESC");
    expect(byName.get("idx_source_documents_created")).toContain("(created_at DESC, id DESC)");
    expect(byName.get("idx_ledger_entries_search")).toContain("gin");
  });

  it("hard-deletes rows and marks only a credential as revoked", async () => {
    const tables = [
      "source_documents",
      "ledger_entries",
      "entry_categories",
      "stored_files",
      "service_credentials",
    ];
    for (const table of tables) {
      const columns = (await fetchColumns(table)).map((column) => column.columnName);
      expect(columns, table).not.toContain("deleted_at");
    }
    const credentialColumns = (await fetchColumns("service_credentials")).map(
      (column) => column.columnName
    );
    expect(credentialColumns).toContain("revoked_at");
  });

  it("names every constraint and index by one convention", async () => {
    const tables = new Set(
      (
        await getTestDb().execute<{ name: string }>(sql`
          SELECT table_name AS name FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
        `)
      ).rows.map((row) => row.name)
    );
    const ownedBy = (name: string, prefix: string) =>
      [...tables].some((table) => name.startsWith(`${prefix}_${table}_`));
    const misnamed: string[] = [];
    for (const row of await fetchConstraints()) {
      const prefix = { c: "ck", f: "fk", u: "uq", p: null }[row.type];
      if (prefix == null) {
        if (!tables.has(row.conname.replace(/_pkey$/, ""))) misnamed.push(row.conname);
      } else if (!ownedBy(row.conname, prefix)) {
        misnamed.push(row.conname);
      }
    }
    for (const row of await fetchIndexes()) {
      if (row.indexname.endsWith("_pkey")) continue;
      const prefix = row.indexdef.startsWith("CREATE UNIQUE") ? "uq" : "idx";
      if (!ownedBy(row.indexname, prefix)) misnamed.push(row.indexname);
    }
    expect(misnamed).toEqual([]);
  });

  it("keeps entries tied to a document and every record dated", async () => {
    const columns = await getTestDb().execute<{
      table: string;
      column: string;
      nullable: string;
      type: string;
    }>(sql`
      SELECT table_name AS table, column_name AS column, is_nullable AS nullable, data_type AS type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (
          ('ledger_entries', 'source_document_id'),
          ('extraction_attempts', 'requested_date'),
          ('extraction_attempts', 'claim_token'),
          ('source_documents', 'document_date')
        )
      ORDER BY table_name, column_name
    `);
    expect(columns.rows).toEqual([
      { table: "extraction_attempts", column: "claim_token", nullable: "YES", type: "uuid" },
      { table: "extraction_attempts", column: "requested_date", nullable: "YES", type: "date" },
      { table: "ledger_entries", column: "source_document_id", nullable: "NO", type: "uuid" },
      { table: "source_documents", column: "document_date", nullable: "NO", type: "date" },
    ]);
    const documentColumns = (await fetchColumns("source_documents")).map(
      (column) => column.columnName
    );
    expect(documentColumns).not.toContain("effective_date");
  });

  it("keeps no passwords or setup state", async () => {
    const passwordColumns = await getTestDb().execute<{ table: string; column: string }>(sql`
      SELECT table_name AS table, column_name AS column
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name ILIKE '%password%'
    `);
    expect(passwordColumns.rows).toEqual([]);
    expect(await fetchColumns("setup_state")).toEqual([]);
  });

  it("keeps no local users, login addresses or session user links", async () => {
    expect(await fetchColumns("users")).toEqual([]);
    expect(await fetchColumns("login_emails")).toEqual([]);
    const sessionColumns = (await fetchColumns("sessions")).map((column) => column.columnName);
    expect(sessionColumns).not.toContain("user_id");
    expect(sessionColumns).not.toContain("authenticated_at");
  });

  it("lets a session be opened with only the provider's address", async () => {
    const db = getTestDb();
    await db.execute(sql`
      INSERT INTO sessions (token_hash, email, expires_at, last_seen_at)
      VALUES ('digest', 'someone@example.com', now() + interval '1 day', now())
    `);
    expect(await db.select({ email: sessions.email }).from(sessions)).toEqual([
      { email: "someone@example.com" },
    ]);
  });

  it("checks category names when a statement ends", async () => {
    const result = await getTestDb().execute<{ definition: string; deferrable: boolean }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition, condeferrable AS deferrable
      FROM pg_constraint
      WHERE conname = 'uq_entry_categories_name'
        AND connamespace = current_schema()::regnamespace
    `);
    expect(result.rows).toEqual([
      {
        definition: "UNIQUE (name) DEFERRABLE",
        deferrable: true,
      },
    ]);
  });

  it("keeps a single ledger", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    await expect(db.insert(ledgers).values({})).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23505", constraint: "uq_ledgers_singleton" }),
    });
  });

  it("keeps no ledger_id column", async () => {
    const result = await getTestDb().execute<{ table: string }>(sql`
      SELECT table_name AS table FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'ledger_id'
    `);
    expect(result.rows).toEqual([]);
  });

  it("refuses to migrate a database that holds more than one ledger", async () => {
    const migration = readFileSync(
      "src/persistence/postgres-migrations/0023_ledger_singleton.sql",
      "utf8"
    );
    const guard = migration.split("--> statement-breakpoint")[0]!;
    const client = await getTestPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP INDEX uq_ledgers_singleton");
      await client.query("INSERT INTO ledgers DEFAULT VALUES");
      await client.query("INSERT INTO ledgers DEFAULT VALUES");
      await expect(client.query(guard)).rejects.toThrow(
        "Cashier expects at most one ledger, found 2"
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("has no named constraint or index drift from the Drizzle model", async () => {
    const model = getDrizzleContractNames();
    const constraintRows = await fetchConstraints();
    const databaseConstraints = new Set(
      constraintRows.filter((row) => row.type !== "p").map((row) => row.conname)
    );
    const constraintBackedIndexes = new Set(
      constraintRows.filter((row) => row.type === "p" || row.type === "u").map((row) => row.conname)
    );
    const databaseIndexes = new Set(
      (await fetchIndexes())
        .map((row) => row.indexname)
        // Primary keys are modeled as columns rather than named table config.
        .filter((name) => !name.endsWith("_pkey"))
        // PostgreSQL exposes UNIQUE constraints as both constraints and backing indexes.
        .filter((name) => !constraintBackedIndexes.has(name))
    );

    expect({
      missingFromDatabase: [...model.constraints].filter((name) => !databaseConstraints.has(name)),
      missingFromModel: [...databaseConstraints].filter(
        (name) => !model.constraints.has(name) && !retiredNames.has(name)
      ),
    }).toEqual({ missingFromDatabase: [], missingFromModel: [] });
    expect({
      missingFromDatabase: [...model.indexes].filter((name) => !databaseIndexes.has(name)),
      missingFromModel: [...databaseIndexes].filter(
        (name) => !model.indexes.has(name) && !retiredNames.has(name)
      ),
    }).toEqual({ missingFromDatabase: [], missingFromModel: [] });
  });

  it("has no column drift from the Drizzle model", async () => {
    // The migrations are hand-written SQL, so a column can exist on one side only without any
    // generated diff noticing.
    const model = getDrizzleColumnNames();
    const database = await fetchAllColumnNames();
    expect({
      missingFromDatabase: [...model].filter((name) => !database.has(name)),
      missingFromModel: [...database].filter((name) => !model.has(name) && !retiredNames.has(name)),
    }).toEqual({ missingFromDatabase: [], missingFromModel: [] });
  });

  it("lists only retired names the database still has", async () => {
    const constraints = new Set((await fetchConstraints()).map((row) => row.conname));
    const indexes = new Set((await fetchIndexes()).map((row) => row.indexname));
    const columns = await fetchAllColumnNames();
    const stale = [...retiredNames].filter(
      (name) => !constraints.has(name) && !indexes.has(name) && !columns.has(name)
    );
    expect(stale).toEqual([]);
  });
});
