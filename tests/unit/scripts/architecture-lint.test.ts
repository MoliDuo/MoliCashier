import { readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import { registeredSourceDocumentWriters } from "../../../eslint.config.mjs";

const repositoryRoot = process.cwd();
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: path.join(repositoryRoot, "eslint.config.mjs"),
    // The probes below are virtual files the TypeScript project does not contain, and these
    // tests check the syntax rules only, so the type-aware server rules stay out of the way.
    overrideConfig: {
      languageOptions: { parserOptions: { projectService: false, project: null } },
      rules: {
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-misused-promises": "off",
      },
    },
  });
});

/** Messages from the architecture's `no-restricted-syntax` rules only. */
async function restrictedSyntax(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repositoryRoot, filePath) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-syntax")
    .map((message) => message.message);
}

const serverFile = "src/modules/demo/server/probe.ts";
const logIdentifierImport = 'import { logIdentifier } from "@/lib/security/log-identifier";\n';

describe("log identifier rule", () => {
  it.each([
    ["a shorthand identifier", "logger.info({ userId }, 'x');"],
    ["a raw identifier value", "logger.error({ fileId: file.id }, 'x');"],
    ["a quoted identifier key", "console.warn({ 'documentId': id });"],
    ["a fatal log", "logger.fatal({ storedFileId: id });"],
  ])("reports %s", async (_label, call) => {
    const messages = await restrictedSyntax(`${logIdentifierImport}${call}`, serverFile);

    expect(messages).toEqual([expect.stringContaining("logIdentifier")]);
  });

  it("reports a logIdentifier call that is not the imported helper", async () => {
    const messages = await restrictedSyntax(
      "logger.info({ userId: logIdentifier('user', id) });",
      serverFile
    );

    expect(messages).toEqual([expect.stringContaining("logIdentifier")]);
  });

  it.each([
    ["an identifier through logIdentifier", "logger.info({ userId: logIdentifier('user', id) });"],
    ["an unrelated field", "logger.info({ count: 1 });"],
    ["another receiver", "audit.info({ userId });"],
    ["console.log, which the rule never covered", "console.log({ userId });"],
    ["a computed key", "logger.info({ [userId]: 1 });"],
    ["an object nested in another call", "logger.info(fields({ userId }));"],
  ])("allows %s", async (_label, call) => {
    expect(await restrictedSyntax(`${logIdentifierImport}${call}`, serverFile)).toEqual([]);
  });

  it("leaves files outside src alone", async () => {
    expect(await restrictedSyntax("logger.info({ userId });", "tests/unit/probe.test.ts")).toEqual(
      []
    );
  });
});

describe("detached logger method rule", () => {
  it.each([
    ["a method picked by a condition", "const log = failed ? logger.error : logger.warn;"],
    ["a method passed as a callback", "promise.catch(logger.error);"],
  ])("reports %s", async (_label, code) => {
    const messages = await restrictedSyntax(code, serverFile);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages).toEqual(messages.map(() => expect.stringContaining("detached pino method")));
  });

  it.each([
    ["a direct call", "logger.warn({ count: 1 }, 'x');"],
    ["a computed level", "logger[failed ? 'error' : 'warn']({ count: 1 }, 'x');"],
  ])("allows %s", async (_label, code) => {
    expect(await restrictedSyntax(code, serverFile)).toEqual([]);
  });
});

describe("typography rules", () => {
  const component = "src/modules/demo/ui/probe.tsx";

  it.each([
    [
      "an arbitrary size in a class attribute",
      '<p className="mt-1 text-[13px]" />',
      "frozen scale",
    ],
    ["an arbitrary rem size in a template", "cn(`p-2 text-[0.8rem] ${tone}`);", "frozen scale"],
    ["the text-muted alias", 'cn("text-muted");', "text-muted-foreground"],
    ["the alias after a substitution", "cn(`${base} text-muted`);", "text-muted-foreground"],
  ])("reports %s", async (_label, code, message) => {
    expect(await restrictedSyntax(`export const x = ${code}`, component)).toEqual([
      expect.stringContaining(message),
    ]);
  });

  it.each([
    ["the muted foreground token", 'cn("text-muted-foreground text-muted-foreground/60");'],
    ["a scale size", 'cn("text-2xl text-micro");'],
    ["a comment", "// text-[13px] and text-muted\nnull;"],
    ["a longer class name", 'cn("my-text-muted");'],
  ])("allows %s", async (_label, code) => {
    expect(await restrictedSyntax(`export const x = ${code}`, component)).toEqual([]);
  });

  describe("raw text size", () => {
    it.each([
      ["a raw size in a class attribute", '<p className="mt-1 text-sm text-destructive" />'],
      ["a raw size behind a variant", 'cn("px-2 sm:text-xs");'],
      ["a raw size in a template", "cn(`${base} text-base`);"],
    ])("reports %s in feature code", async (_label, code) => {
      for (const file of [component, "src/app/probe/page.tsx", "src/components/probe.tsx"]) {
        expect(await restrictedSyntax(`export const x = ${code}`, file)).toEqual([
          expect.stringContaining("@/components/typography"),
        ]);
      }
    });

    it.each([
      ["a role", 'textRoleClassName("body", "mt-1 text-destructive");'],
      ["a longer token", 'cn("text-xsomething my-text-sm");'],
      ["a comment", "// text-sm\nnull;"],
    ])("allows %s in feature code", async (_label, code) => {
      expect(await restrictedSyntax(`export const x = ${code}`, component)).toEqual([]);
    });

    it.each([
      "src/components/ui/probe.tsx",
      "src/components/skeletons/probe.tsx",
      "src/components/typography.ts",
      "src/modules/currency/ui/amount-text.tsx",
      "src/modules/demo/server/probe.ts",
    ])("allows a raw size in %s", async (file) => {
      expect(await restrictedSyntax('export const x = cn("text-sm text-lg");', file)).toEqual([]);
    });
  });
});

describe("source document writer rule", () => {
  const writes = [
    "tx.insert(sourceDocuments).values(row);",
    "db.update(sourceDocuments).set(patch);",
    "tx.delete(sourceDocuments).where(match);",
    "tx.execute(sql`UPDATE source_documents SET title = ${title}`);",
    "tx.execute(sql`\n  update source_documents AS target SET input_text = ${text}`);",
    "tx.execute(sql`INSERT INTO source_documents (id) VALUES (${id})`);",
    "tx.execute(sql`DELETE FROM source_documents WHERE id = ${id}`);",
    'client.query("delete from \\"source_documents\\" where id = $1", [id]);',
  ];

  it.each(writes)("reports %s outside a registered writer", async (write) => {
    expect(await restrictedSyntax(write, serverFile)).toEqual([
      expect.stringContaining("registered source-document writer"),
    ]);
  });

  it.each(writes)("allows %s in a registered writer or a migration", async (write) => {
    expect(await restrictedSyntax(write, registeredSourceDocumentWriters[0]!)).toEqual([]);
    expect(await restrictedSyntax(write, "src/persistence/postgres-migrations/probe.ts")).toEqual(
      []
    );
  });

  it("allows reads and writes to other tables", async () => {
    const code = "tx.select().from(sourceDocuments);\ntx.insert(ledgerEntries).values(row);";

    expect(await restrictedSyntax(code, serverFile)).toEqual([]);
  });

  it("allows raw SQL that reads the table or writes a similarly named one", async () => {
    const code = [
      "tx.execute(sql`SELECT id FROM source_documents WHERE id = ${id}`);",
      "tx.execute(sql`DELETE FROM source_document_files WHERE source_document_id = ${id}`);",
      "tx.execute(sql`UPDATE ledger_entries SET amount = 1 FROM source_documents`);",
    ].join("\n");

    expect(await restrictedSyntax(code, serverFile)).toEqual([]);
  });

  it.each(registeredSourceDocumentWriters)("%s still writes sourceDocuments", async (file) => {
    const source = readFileSync(path.join(repositoryRoot, file), "utf8");
    const messages = await restrictedSyntax(source, serverFile);

    expect(messages).toContainEqual(expect.stringContaining("registered source-document writer"));
  });
});
