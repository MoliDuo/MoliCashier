import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ledgerEntries, sourceDocuments, storedFiles } from "@/persistence";
import {
  activateTestSourceDocumentProjection,
  createTestLedger,
  testBookId,
  createTestRecord,
} from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { listTargetSourceDocuments } from "@/modules/source-document/server/reads/list";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";

const SOURCE_LIST_KEYS = [
  "bookId",
  "failureKind",
  "failureMessage",
  "canEdit",
  "createdAt",
  "documentDate",
  "errorCode",
  "hasImages",
  "id",
  "latestAttemptId",
  "ledgerEntries",
  "pendingSuggestions",
  "processingStatus",
  "supportedActions",
  "text",
  "title",
  "updatedAt",
  "version",
];

function normalizeSql(statement: string): string {
  return statement.toLowerCase().replace(/\s+/g, " ").trim();
}

async function captureSqlStatements<T>(fn: (getStatements: () => string[]) => Promise<T>) {
  interface CapturedConnection {
    query: (query: string | { text?: string }, ...args: unknown[]) => Promise<unknown>;
    release: (...args: unknown[]) => void;
  }
  const dbWithClient = getTestDb() as unknown as {
    $client?: {
      query: (query: string | { text?: string }, ...args: unknown[]) => Promise<unknown>;
      connect: (...args: unknown[]) => unknown;
    };
  };
  const client = dbWithClient.$client;
  if (client == null) throw new Error("Expected drizzle client to exist in integration tests");
  const originalQuery = client.query.bind(client);
  const originalConnect = client.connect.bind(client);
  const statements: string[] = [];
  const record = (query: string | { text?: string }) => {
    statements.push(typeof query === "string" ? query : (query.text ?? ""));
  };
  client.query = ((query: string | { text?: string }, ...args: unknown[]) => {
    record(query);
    return originalQuery(query, ...args);
  }) as typeof client.query;
  const instrumentConnection = (connection: CapturedConnection) => {
    const connectionQuery = connection.query.bind(connection);
    const connectionRelease = connection.release.bind(connection);
    connection.query = ((query: string | { text?: string }, ...queryArgs: unknown[]) => {
      record(query);
      return connectionQuery(query, ...queryArgs);
    }) as typeof connection.query;
    connection.release = ((...releaseArgs: unknown[]) => {
      connection.query = connectionQuery;
      connection.release = connectionRelease;
      connectionRelease(...releaseArgs);
    }) as typeof connection.release;
    return connection;
  };
  client.connect = ((...args: unknown[]) => {
    const callback = args[0];
    if (typeof callback === "function") {
      return originalConnect(
        (error: Error | undefined, connection: CapturedConnection | undefined, done: () => void) =>
          callback(error, connection == null ? connection : instrumentConnection(connection), done)
      );
    }
    return Promise.resolve(originalConnect(...args)).then((connection) =>
      instrumentConnection(connection as CapturedConnection)
    );
  }) as typeof client.connect;
  try {
    const result = await fn(() => [...statements]);
    return { result, statements };
  } finally {
    client.query = originalQuery;
    client.connect = originalConnect;
  }
}

const LEDGER_LIST_KEYS = [
  "amount",
  "categoryId",
  "convertedAmount",
  "createdAt",
  "currency",
  "description",
  "exchangeRate",
  "id",
  "itemName",
  "sourceDocument",
  "sourceDocumentId",
  "updatedAt",
];

async function collectSourceDocumentPages(limit: number) {
  const items = [];
  let cursor: string | null = null;
  const pageSizes: number[] = [];
  do {
    const page = await listStreamPage({ limit, cursor });
    items.push(...page.items);
    pageSizes.push(page.items.length);
    cursor = page.nextCursor;
  } while (cursor != null);
  return { items, pageSizes };
}

async function collectLedgerEntryPages(limit: number) {
  const items = [];
  let cursor: string | null = null;
  const pageSizes: number[] = [];
  do {
    const page = await listLedgerEntries({ limit, cursor: cursor ?? undefined });
    items.push(...page.items);
    pageSizes.push(page.items.length);
    cursor = page.nextCursor;
  } while (cursor != null);
  return { items, pageSizes };
}

describe("bounded target read models", () => {
  it("keeps source-document list and detail reads within fixed query budgets", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        documentDate: "2026-09-03",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    await db.insert(ledgerEntries).values({
      sourceDocumentId: document!.id,
      amount: "12.00",
      currency: "CNY",
      itemName: "Bounded item",
    });
    await activateTestSourceDocumentProjection(db, document!.id, {
      text: "bounded evidence",
      imageUrls: ["/api/uploads/bounded.jpg"],
    });

    const readStatements = (statements: string[]) =>
      statements
        .map(normalizeSql)
        .filter((statement) => /^(select|with)\b/.test(statement))
        .filter((statement, index, normalized) => statement !== normalized[index - 1]);
    const capture = await captureSqlStatements(async (getStatements) => {
      const list = await listTargetSourceDocuments({ limit: 20 });
      const afterList = readStatements(getStatements()).length;
      const detail = await getTargetSourceDocument(document!.id);
      const afterDetail = readStatements(getStatements()).length;
      const evidence = await getSourceDocumentInput(document!.id);
      const afterEvidence = readStatements(getStatements()).length;
      await listStreamPage({ limit: 20 });
      const afterStream = readStatements(getStatements()).length;
      const ledgerPage = await listLedgerEntries({ limit: 20 });
      const afterLedgerPage = readStatements(getStatements()).length;
      return {
        list,
        detail,
        evidence,
        ledgerPage,
        listReadCount: afterList,
        detailReadCount: afterDetail - afterList,
        evidenceReadCount: afterEvidence - afterDetail,
        evidenceStatements: readStatements(getStatements()).slice(afterDetail, afterEvidence),
        streamReadCount: afterStream - afterEvidence,
        ledgerPageReadCount: afterLedgerPage - afterStream,
      };
    });

    expect(capture.result.list.items).toHaveLength(1);
    expect(capture.result.detail?.files).toHaveLength(1);
    expect(capture.result.detail?.ledgerEntries).toHaveLength(1);
    expect(capture.result.evidence?.files).toHaveLength(1);
    expect(capture.result.evidence).not.toHaveProperty("ledgerEntries");
    expect(capture.result.ledgerPage.items).toHaveLength(1);
    expect(capture.result.listReadCount).toBeLessThanOrEqual(4);
    expect(capture.result.detailReadCount).toBeLessThanOrEqual(3);
    expect(capture.result.evidenceReadCount).toBe(2);
    expect(capture.result.evidenceStatements.join(" ")).not.toContain("ledger_entries");
    expect(capture.result.streamReadCount).toBe(4);
    expect(capture.result.ledgerPageReadCount).toBeLessThanOrEqual(2);
  });

  it.each([1, 3])("checks ownership for %i stored files with one select", async (fileCount) => {
    const db = getTestDb();
    await createTestLedger(db);
    const files = await db
      .insert(storedFiles)
      .values(
        Array.from({ length: fileCount }, (_, index) => ({
          storageKey: `bounded-ownership/${fileCount}/${index}`,
          contentType: "image/jpeg",
          byteSize: 1,
        }))
      )
      .returning({ id: storedFiles.id });

    const capture = await captureSqlStatements(async () =>
      createPendingAttempt({
        input: {
          text: null,
          storedFileIds: files.map((file) => file.id),
          documentDate: null,
        },
        bookId: await testBookId(db),
      })
    );
    const ownershipSelects = capture.statements
      .map(normalizeSql)
      .filter((statement) => statement.startsWith("select"))
      .filter((statement) => statement.includes('from "stored_files"'));

    expect(ownershipSelects).toHaveLength(1);
  });

  it("paginates a large source-document history with a bounded list DTO", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const historySize = 31;
    const sensitiveText = "full-source-text-that-must-not-enter-history";
    const sensitiveUrl = "/api/uploads/private/history-receipt.jpg";
    const localPath = "/var/lib/cashier/uploads/private/history-receipt.jpg";
    const storageKey = "private/history-receipt.jpg";
    const createdAt = new Date("2026-07-15T08:00:00.000Z");
    const documents = await db
      .insert(sourceDocuments)
      .values(
        Array.from({ length: historySize }, (_, index) => ({
          title: `Receipt ${index}`,
          documentDate: "2026-07-15",
          createdAt,
          updatedAt: createdAt,
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        }))
      )
      .returning();
    for (const [index, document] of documents.entries()) {
      await activateTestSourceDocumentProjection(db, document.id, {
        text: `${sensitiveText}-${index}`,
        imageUrls: [`${sensitiveUrl}/${index}`],
      });
    }

    const firstPage = await listStreamPage({ limit: 7 });
    const history = await collectSourceDocumentPages(7);
    const serialized = JSON.stringify(firstPage);

    expect(history.items).toHaveLength(historySize);
    expect(new Set(history.items.map((item) => item.id))).toHaveLength(historySize);
    expect(history.pageSizes).toEqual([7, 7, 7, 7, 3]);
    expect(firstPage.items.every((item) => item.text === null)).toBe(true);
    expect(Object.keys(firstPage.items[0]!).sort()).toEqual([...SOURCE_LIST_KEYS].sort());
    expect(serialized.length).toBeLessThan(10_000);
    for (const forbidden of [
      sensitiveText,
      sensitiveUrl,
      storageKey,
      localPath,
      "sourceDocumentAttemptId",
      "attemptNumber",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const detail = (await getSourceDocumentInput(documents[0]!.id))!;
    expect(Object.keys(detail).sort()).toEqual(
      ["createdAt", "documentDate", "files", "id", "processingStatus", "text"].sort()
    );
    expect(detail.text).toBe(`${sensitiveText}-0`);
    expect(detail.files).toEqual([
      {
        id: expect.any(String),
        contentType: "image/jpeg",
        byteSize: 1,
        originalFilename: null,
      },
    ]);
    expect(JSON.stringify(detail)).not.toContain(sensitiveUrl);
    expect(JSON.stringify(detail)).not.toContain(storageKey);
    expect(JSON.stringify(detail)).not.toContain(localPath);
  });

  it("paginates a large ledger history without leaking source evidence or internal attempts", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const historySize = 31;
    const sensitiveText = "full-ledger-source-text-that-must-not-enter-list";
    const sensitiveUrl = "/api/uploads/private/ledger-receipt.jpg";
    const localPath = "/var/lib/cashier/uploads/private/ledger-receipt.jpg";
    const storageKey = "private/ledger-receipt.jpg";
    const createdAt = "2026-07-15T08:00:00.000Z";
    const created = await createTestRecord(getTestDb(), {
      title: "Large receipt",
      inputText: sensitiveText,
      entryDate: "2026-07-15",
      entries: Array.from({ length: historySize }, (_, index) => ({
        id: crypto.randomUUID(),
        categoryId: null,
        amount: `${index + 1}.25`,
        currency: "CNY",
        itemName: `Item ${index}`,
        description: null,
        createdAt,
      })),
      bookId: await testBookId(db),
    });
    const firstPage = await listLedgerEntries({ limit: 7 });
    const history = await collectLedgerEntryPages(7);
    const serialized = JSON.stringify(firstPage);

    expect(history.items).toHaveLength(historySize);
    expect(new Set(history.items.map((item) => item.id))).toHaveLength(historySize);
    expect(history.pageSizes).toEqual([7, 7, 7, 7, 3]);
    expect(Object.keys(firstPage.items[0]!).sort()).toEqual([...LEDGER_LIST_KEYS].sort());
    expect(firstPage.items[0]?.sourceDocument).toMatchObject({
      id: created.sourceDocumentId,
      hasImages: false,
    });
    expect(serialized.length).toBeLessThan(15_000);
    for (const forbidden of [
      sensitiveText,
      sensitiveUrl,
      storageKey,
      localPath,
      "sourceDocumentAttemptId",
      "activeAttemptId",
      "latestAttemptId",
      "attemptNumber",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
