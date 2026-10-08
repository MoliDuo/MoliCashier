import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { POST } from "@/app/api/ledger-queries/route";
import { getTestDb } from "tests/setup";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { createLedgerData, createSourceDocumentData } from "tests/helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { insertExchangeRates } from "tests/helpers/exchange-rates";
import { logger } from "@/lib/logger";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

function request(query: string, args: unknown[]) {
  return new Request("http://localhost/api/ledger-queries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, args }),
  });
}

describe("session ledger query transport", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(testSession());
  });

  it("returns private scoped detail", async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(db);
    const document = createSourceDocumentData({ status: "completed" });
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, document.id);

    const response = await POST(request("detail", [document.id]));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ id: document.id, version: 1 });

    // An unknown document inside the live ledger is an empty read, not an
    // error: the detail loader reports "no such record" with a null body.
    const unknownDocument = await POST(request("detail", [crypto.randomUUID()]));
    expect(unknownDocument.status).toBe(200);
    expect(await unknownDocument.json()).toBeNull();
  });

  it("requires a session and validates query envelopes", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    expect((await POST(request("detail", [crypto.randomUUID()]))).status).toBe(401);
    expect((await POST(request("delete", [crypto.randomUUID()]))).status).toBe(401);

    vi.mocked(getCurrentSession).mockResolvedValue(testSession());
    expect((await POST(request("delete", [crypto.randomUUID()]))).status).toBe(400);
    expect((await POST(request("detail", ["invalid", "invalid"]))).status).toBe(400);
  });

  it("turns away a request without a session before reading its body", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
          throw new Error("the body should not be read");
        },
      },
      { highWaterMark: 0 }
    );
    const response = await POST(
      new Request("http://localhost/api/ledger-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit)
    );

    expect(response.status).toBe(401);
    expect(pulled).toBe(false);
  });

  it("refuses an oversized or malformed body", async () => {
    const oversized = new Request("http://localhost/api/ledger-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "ledger", args: ["x".repeat(1024 * 1024)] }),
    });
    expect((await POST(oversized)).status).toBe(413);

    const malformed = new Request("http://localhost/api/ledger-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect((await POST(malformed)).status).toBe(400);
  });

  it("does not log a request the reader dropped while its body was read", async () => {
    const errorLog = vi.spyOn(logger, "error");
    const dropped = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(dropped);
      },
    });
    const abandoned = new Request("http://localhost/api/ledger-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);

    expect((await POST(abandoned)).status).toBe(500);
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("validates each supported read without leaking internal error data", async () => {
    await getTestDb().insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(getTestDb());
    for (const query of [
      "detail",
      "stream",
      "total",
      "refresh",
      "entries",
      "entry",
      "ledger",
      "books",
      "books-including-archived",
      "book",
      "categories",
      "summary",
      "settings",
      "source-document-input",
      "convert-currency",
      "forecast",
    ]) {
      const response = await POST(request(query, [{ unexpected: true }]));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "QUERY_FAILED" });
    }
    expect((await POST(request("stats", [{}]))).status).toBe(400);
  });

  it("refuses a stats book that is not a book id before reading with it", async () => {
    await getTestDb().insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(getTestDb());

    const response = await POST(
      request("stats", [{ bookId: "not-a-book", period: { range: "all" } }])
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "QUERY_FAILED" });
  });

  it("serves the settings reads over the same scoped transport", async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(db);

    const ledgerRead = await POST(request("ledger", []));
    expect(ledgerRead.status).toBe(200);
    expect(ledgerRead.headers.get("cache-control")).toBe("private, no-store");
    expect(await ledgerRead.json()).toMatchObject({
      settings: expect.objectContaining({ mainCurrency: "CNY" }),
    });

    const categoriesRead = await POST(request("categories", []));
    expect(categoriesRead.status).toBe(200);
    expect(categoriesRead.headers.get("cache-control")).toBe("private, no-store");
    expect(await categoriesRead.json()).toEqual([]);

    const settingsRead = await POST(request("settings", []));
    expect(settingsRead.status).toBe(200);
    expect(settingsRead.headers.get("cache-control")).toBe("private, no-store");
    expect(await settingsRead.json()).toEqual({ uncategorizedCount: 0, credentials: [] });
  });

  it("serves the books reads over the same scoped transport", async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    const books = await ensureTestLedgerBooks(db, ["共同支出", "旧账"]);
    const liveBookId = books.get("共同支出")!;
    const retiredBookId = books.get("旧账")!;
    await db.execute(sql`UPDATE books SET archived_at = now() WHERE id = ${retiredBookId}`);

    const live = await POST(request("books", []));
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("private, no-store");
    expect((await live.json()).map((book: { id: string }) => book.id)).toEqual([liveBookId]);

    // The retired book is named on its own and listed beside the live one, but
    // never in the switcher's list.
    const withArchived = await POST(request("books-including-archived", []));
    expect(withArchived.status).toBe(200);
    expect(withArchived.headers.get("cache-control")).toBe("private, no-store");
    expect((await withArchived.json()).map((book: { id: string }) => book.id).sort()).toEqual(
      [liveBookId, retiredBookId].sort()
    );

    const retired = await POST(request("book", [retiredBookId]));
    expect(retired.status).toBe(200);
    expect(await retired.json()).toMatchObject({ id: retiredBookId, name: "旧账" });
    expect(await (await POST(request("book", [crypto.randomUUID()]))).json()).toBeNull();
    expect((await POST(request("book", ["not-a-uuid"]))).status).toBe(400);

    // A read that takes no arguments refuses one.
    expect((await POST(request("books", [crypto.randomUUID()]))).status).toBe(400);
  });

  it("serves a document's input for a retry, and 404 for an unknown one", async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(db);
    const document = createSourceDocumentData({ status: "completed" });
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, document.id);

    const read = await POST(request("source-document-input", [document.id]));
    expect(read.status).toBe(200);
    expect(await read.json()).toHaveProperty("files");
    expect((await POST(request("source-document-input", [crypto.randomUUID()]))).status).toBe(404);
    expect((await POST(request("source-document-input", ["not-a-uuid"]))).status).toBe(400);
  });

  it("converts with the stored rate of the day, and is a 409 without one", async () => {
    await getTestDb().insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(getTestDb());
    await insertExchangeRates("2026-02-04", { CNY: 7.5, USD: 1.1 });

    const converted = await POST(
      request("convert-currency", [{ amount: "100", from: "CNY", to: "USD", date: "2026-02-04" }])
    );
    expect(converted.status).toBe(200);
    const { converted: amount } = (await converted.json()) as { converted: string };
    expect(Number.parseFloat(amount)).toBeCloseTo(14.67, 1);

    const missing = await POST(
      request("convert-currency", [{ amount: "100", from: "CNY", to: "JPY", date: "2026-02-04" }])
    );
    expect(missing.status).toBe(409);
  });

  describe("periods", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** A ledger in Shanghai with one record on each side of the month boundary. */
    async function seedAcrossMonths(ahead: ReadonlyArray<readonly [string, string]> = []) {
      const db = getTestDb();
      await db.insert(ledgers).values(createLedgerData({ timeZone: "Asia/Shanghai" }));
      await ensureTestLedgerBooks(db);
      for (const [title, date] of [
        ["September", "2026-09-30"],
        ["October", "2026-10-01"],
        ...ahead,
      ] as const) {
        const [document] = await db
          .insert(sourceDocuments)
          .values({
            title,
            documentDate: date,
            bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
          })
          .returning({ id: sourceDocuments.id });
        await db.insert(ledgerEntries).values({
          sourceDocumentId: document!.id,
          amount: "10.00",
          currency: "CNY",
          itemName: title,
        });
        await activateTestSourceDocumentProjection(db, document!.id, { parsed: true });
      }
      // 16:30 UTC on the 30th is already the 1st of October in Shanghai.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
    }

    it("reads this month in the ledger's zone, not the server's", async () => {
      await seedAcrossMonths();
      const period = { range: "month", offset: 0 };

      const stream = await (await POST(request("stream", [{ period }]))).json();
      expect(stream.items.map((item: { title: string }) => item.title)).toEqual(["October"]);
      expect(stream.items[0]).toMatchObject({ documentDate: "2026-10-01" });

      const entries = await (await POST(request("entries", [{ period }]))).json();
      expect(entries.items.map((item: { itemName: string }) => item.itemName)).toEqual(["October"]);

      const previous = await (
        await POST(request("summary", [{ period: { range: "month", offset: -1 } }]))
      ).json();
      expect(previous).toMatchObject({ convertedTotal: expect.objectContaining({ total: "10" }) });
    });

    it("resolves 统计's period and says which days it covers", async () => {
      await seedAcrossMonths();

      const month = await (
        await POST(request("stats", [{ period: { range: "month", offset: 0 } }]))
      ).json();
      expect(month.range).toEqual({ from: "2026-10-01", to: "2026-10-01" });

      const all = await (await POST(request("stats", [{ period: { range: "all" } }]))).json();
      expect(all.range).toEqual({ from: "2026-09-30", to: "2026-10-01" });
      expect(all.summary.total).toBe("20");
    });

    it("reads a month ahead for bills dated ahead, and leaves 全部 at today", async () => {
      await seedAcrossMonths([["November", "2026-11-15"]]);

      const next = await (
        await POST(request("stream", [{ period: { range: "month", offset: 1 } }]))
      ).json();
      expect(next.items.map((item: { title: string }) => item.title)).toEqual(["November"]);

      const all = await (await POST(request("stats", [{ period: { range: "all" } }]))).json();
      expect(all.range.to).toBe("2026-10-01");
      expect(all.summary.total).toBe("20");
    });

    it("refuses a period it cannot read", async () => {
      await seedAcrossMonths();
      for (const period of [
        { range: "month", offset: 13 },
        { range: "month", offset: -120 },
        { range: "custom", from: "2026-09-10", to: "2026-09-01" },
        { range: "decade" },
      ]) {
        expect((await POST(request("stream", [{ period }]))).status).toBe(400);
      }
    });
  });
});
