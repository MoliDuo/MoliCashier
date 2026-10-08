import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

const migrationsDirectory = path.resolve("src/persistence/postgres-migrations");
const journal = JSON.parse(
  readFileSync(path.join(migrationsDirectory, "meta/_journal.json"), "utf8")
) as { entries: Array<JournalEntry> };

describe("Postgres migration journal", () => {
  it("starts from the baseline and only moves forward in time", () => {
    // Drizzle applies a migration only when it is newer than the last one a
    // database recorded, so an out-of-order timestamp would be skipped.
    expect(journal.entries[0]?.tag).toBe("0000_baseline");
    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
      if (index > 0) expect(entry.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    });
  });

  it("keeps the journal in sync with the actual migration files", () => {
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(sqlFiles).toEqual(journal.entries.map((entry) => `${entry.tag}.sql`));
  });

  it("keeps one snapshot, for the newest migration, next to the journal", () => {
    // `db:generate` diffs the schema against the newest snapshot, so it has to
    // describe the schema the newest migration leaves behind.
    const newestPrefix = journal.entries.at(-1)!.tag.slice(0, 4);
    expect(readdirSync(path.join(migrationsDirectory, "meta")).sort()).toEqual([
      `${newestPrefix}_snapshot.json`,
      "_journal.json",
    ]);
  });

  it("builds the baseline in the current schema rather than in public", () => {
    const sql = readFileSync(path.join(migrationsDirectory, "0000_baseline.sql"), "utf8");
    const qualified = sql.match(/\bpublic\.\w+/g) ?? [];
    expect(new Set(qualified)).toEqual(new Set(["public.gin_trgm_ops"]));
    expect(sql).not.toMatch(/^\\/m);
  });

  it("names no schema in a migration, beyond the ones already applied", () => {
    // Tests build their databases in a schema of their own choosing, and a
    // migration naming `public` would reach past it. drizzle-kit writes the
    // quoted `"public".` form into foreign keys, so a generated migration has
    // to have it taken out. The trigram operator class lives where the
    // extension was installed and is the one name that may be qualified.
    const qualifiedName = /"?\bpublic"?\s*\.\s*"?\w+"?/gi;
    const found: Record<string, string[]> = {};
    for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(path.join(migrationsDirectory, file), "utf8");
      const names = (sql.match(qualifiedName) ?? []).filter(
        (name) => name !== "public.gin_trgm_ops"
      );
      if (names.length > 0) found[file] = names;
    }
    // Already applied everywhere, so left as they are.
    expect(found).toEqual({
      "0031_ai_learned_preferences.sql": ['"public"."source_documents"'],
    });
  });
});
