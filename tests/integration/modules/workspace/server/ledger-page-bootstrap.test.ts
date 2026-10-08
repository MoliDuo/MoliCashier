import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DehydratedState } from "@tanstack/react-query";
import { getTestDb } from "tests/setup";
import { activateTestSourceDocumentProjection, createTestLedger } from "tests/helpers/schema-setup";
import {
  books,
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import {
  getLedgerRouteBootstrap,
  getLedgerBooksBootstrap,
  getLedgerShellBootstrap,
  loadLedgerView,
} from "@/modules/workspace/server/ledger-page-bootstrap";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { resolveAuthenticatedHome } from "@/modules/workspace/server/resolve-authenticated-home";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { Period } from "@/modules/ledger/domain/period";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";

const request = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  failBooks: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies[name];
      return value == null ? undefined : { name, value };
    },
  }),
}));

// The one failure this file injects: a books read that errors, which the page
// has to survive without losing the reader's remembered book.
vi.mock("@/modules/ledger/server/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ledger/server/books")>();
  return {
    ...actual,
    listBooks: async (...args: Parameters<typeof actual.listBooks>) => {
      if (request.failBooks) throw new Error("books are down");
      return actual.listBooks(...args);
    },
  };
});

interface PageInput {
  page: LedgerTab;
  period?: Period;
  advancedFilters?: LedgerAdvancedFilters;
  /** The book the scope cookie names. */
  bookId?: string;
}

/**
 * One document request: the layout's view and shell data, then the route's
 * first screen, composed the way the ledger layout and page compose them.
 */
async function loadPage(input: PageInput) {
  request.cookies = input.bookId == null ? {} : { CASHIER_BOOK_SCOPE: input.bookId };
  const view = await loadLedgerView();
  const { ledgerDto } = await resolveAuthenticatedHome();
  const [shell, route] = await Promise.all([
    getLedgerShellBootstrap({
      ledgerDto,
      categories: view.categories,
      categoryAssignmentJob: view.categoryAssignmentJob,
    }),
    getLedgerRouteBootstrap({
      page: input.page,
      ledgerDto,
      scope: view,
      ...(input.period === undefined ? {} : { period: input.period }),
      ...(input.advancedFilters === undefined ? {} : { advancedFilters: input.advancedFilters }),
    }),
  ]);
  return { view, books: getLedgerBooksBootstrap(view.books), shell, route };
}

function query(state: DehydratedState, ...prefix: string[]) {
  return state.queries.find((candidate) =>
    prefix.every((segment, index) => candidate.queryKey[index] === segment)
  );
}

function streamTitles(state: DehydratedState): string[] {
  const data = query(state, "ledger", "source-documents", "stream")?.state.data as
    { pages: Array<{ items: Array<{ title: string | null }> }> } | undefined;
  return (data?.pages ?? []).flatMap((page) => page.items.map((item) => item.title ?? ""));
}

function entryNames(state: DehydratedState): string[] {
  const data = query(state, "ledger", "entries")?.state.data as
    { pages: Array<{ items: Array<{ itemName: string }> }> } | undefined;
  return (data?.pages ?? []).flatMap((page) => page.items.map((item) => item.itemName)).sort();
}

describe("ledger page bootstrap", () => {
  let bookId = "";
  let otherBookId = "";

  /** A parsed document with one entry per amount, filed into a book on a day. */
  async function seedDocument(input: {
    title: string;
    date: string;
    amounts: string[];
    book?: string;
  }): Promise<string> {
    const db = getTestDb();
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        title: input.title,
        documentDate: input.date,
        bookId: input.book ?? bookId,
      })
      .returning({ id: sourceDocuments.id });
    await db.insert(ledgerEntries).values(
      input.amounts.map((amount, index) => ({
        sourceDocumentId: document!.id,
        amount,
        currency: "CNY",
        itemName: `${input.title} ${index + 1}`,
      }))
    );
    await activateTestSourceDocumentProjection(db, document!.id, { parsed: true });
    return document!.id;
  }

  async function setLedgerZone(timeZone: string) {
    await getTestDb().update(ledgers).set({ timeZone });
  }

  beforeEach(async () => {
    request.cookies = {};
    request.failBooks = false;
    const db = getTestDb();
    await createTestLedger(db);
    [bookId] = await db
      .select({ id: books.id })
      .from(books)
      .then((rows) => rows.map((row) => row.id));
    [{ id: otherBookId }] = (await db
      .insert(books)
      .values({ name: "哞哞的", sortOrder: 2 })
      .returning({ id: books.id })) as [{ id: string }];
    await db.insert(entryCategories).values({ name: "吃喝", sortOrder: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dehydrates the live books for the bars, and the ledger and its categories for the shell", async () => {
    const { books, shell, view } = await loadPage({ page: "records" });

    expect(books.queries.map((candidate) => candidate.queryKey)).toEqual([["ledger", "books"]]);
    expect(
      (query(books, "ledger", "books")?.state.data as Array<{ id: string }>).map((b) => b.id)
    ).toEqual([bookId, otherBookId]);
    expect(query(shell, "ledger")?.state.data).toMatchObject({
      settings: expect.objectContaining({ mainCurrency: "CNY" }),
    });
    expect(query(shell, "ledger", "books")).toBeUndefined();
    expect(query(shell, "ledger", "categories")?.state.data).toEqual([
      expect.objectContaining({ name: "吃喝" }),
    ]);
    expect(view.books).toHaveLength(2);
    // A ledger that never had a run says so, rather than leaving the read to the client.
    const run = query(shell, "ledger", "category-assignment");
    expect(run).toMatchObject({ state: { data: null } });
  });

  it("dehydrates the ledger's latest assignment run for the shell", async () => {
    const [job] = await getTestDb()
      .insert(categoryAssignmentJobs)
      .values({ mode: "clear", status: "running" })
      .returning();

    const { shell } = await loadPage({ page: "records" });

    expect(query(shell, "ledger", "category-assignment")?.state.data).toMatchObject({
      id: job!.id,
      status: "running",
    });
  });

  it("leaves the run to the client when it cannot be read, and keeps the rest", async () => {
    const view = await loadLedgerView();
    const { ledgerDto } = await resolveAuthenticatedHome();
    const failed = Promise.reject(new Error("runs are down"));
    failed.catch(() => {});

    const shell = await getLedgerShellBootstrap({
      ledgerDto,
      categories: view.categories,
      categoryAssignmentJob: failed,
    });

    expect(query(shell, "ledger", "category-assignment")).toBeUndefined();
    expect(query(shell, "ledger", "categories")?.state.data).toHaveLength(1);
  });

  it("prefetches the ledger's month of the stream, its total and the refresh baseline", async () => {
    await seedDocument({ title: "October lunch", date: "2026-10-01", amounts: ["30.00"] });
    await seedDocument({ title: "September lunch", date: "2026-09-30", amounts: ["20.00"] });

    // 16:30 UTC on the 30th is already October in Shanghai, the ledger's zone,
    // where the deployment's UTC would still say September.
    const { view, route } = await loadPage({ page: "records" });

    expect(view.ledgerToday).toBe("2026-10-01");
    expect(query(route, "ledger", "source-documents", "stream")?.queryKey[3]).toMatchObject({
      period: "month:0",
    });
    expect(streamTitles(route)).toEqual(["October lunch"]);
    expect(query(route, "ledger", "source-documents", "stream-total")?.state.data).toMatchObject({
      total: "30",
    });
    expect(query(route, "ledger-sync")?.state.data).toMatchObject({
      changed: false,
      hasTransitionalWork: false,
    });
    expect(query(route, "ledger", "entries")).toBeUndefined();
    expect(query(route, "ledger", "enhanced-stats")).toBeUndefined();
  });

  it("dates every book by the ledger's one zone", async () => {
    await setLedgerZone("Europe/London");
    await seedDocument({ title: "Ours", date: "2026-09-20", amounts: ["10.00"] });
    await seedDocument({
      title: "Hers",
      date: "2026-09-20",
      amounts: ["10.00"],
      book: otherBookId,
    });

    const { view, route } = await loadPage({ page: "records", bookId: otherBookId });

    // London is still in September, so this month is September for every book.
    expect(view.bookId).toBe(otherBookId);
    expect(view.ledgerToday).toBe("2026-09-30");
    expect(streamTitles(route)).toEqual(["Hers"]);
  });

  it("applies the amount, status and search filters to the stream and its total", async () => {
    await setLedgerZone("Europe/London");
    await seedDocument({ title: "coffee beans", date: "2026-09-10", amounts: ["50.00"] });
    await seedDocument({ title: "coffee cup", date: "2026-09-11", amounts: ["5.00"] });
    await seedDocument({ title: "tea", date: "2026-09-12", amounts: ["60.00"] });

    const { route } = await loadPage({
      page: "records",
      advancedFilters: {
        minAmount: "20",
        maxAmount: "100",
        search: "  coffee ",
        statuses: ["completed"],
      },
    });

    expect(streamTitles(route)).toEqual(["coffee beans"]);
    expect(query(route, "ledger", "source-documents", "stream-total")?.state.data).toMatchObject({
      total: "50",
    });
  });

  it("prefetches the details summary and entries with the advanced filters", async () => {
    await seedDocument({
      title: "Groceries",
      date: "2026-09-15",
      amounts: ["10.00", "50.00", "150.00"],
    });

    const { route } = await loadPage({
      page: "entries",
      period: { range: "custom", from: "2026-09-01", to: "2026-09-30" },
      advancedFilters: { minAmount: "20", maxAmount: "100" },
    });

    expect(entryNames(route)).toEqual(["Groceries 2"]);
    expect(query(route, "ledger", "summary")?.state.data).toMatchObject({
      convertedTotal: expect.objectContaining({ total: "50" }),
    });
    expect(query(route, "ledger", "source-documents", "stream")).toBeUndefined();
  });

  it("prefetches stats under the key the stats tab asks for, for the remembered book", async () => {
    const period: Period = { range: "year", offset: -2 };
    const { view, route } = await loadPage({ page: "stats", bookId, period });

    const expected = buildStatsQueryDescriptor({ bookId, period, mainCurrency: "CNY" });
    const stats = query(route, "ledger", "enhanced-stats");
    expect(view.bookId).toBe(bookId);
    expect(stats?.queryKey).toEqual(expected.queryKey);
    expect(stats?.state.status).toBe("success");
    // Two years before 2026-10-01 in Shanghai.
    expect(stats?.state.data).toMatchObject({ range: { from: "2024-01-01", to: "2024-12-31" } });
  });

  it("prefetches 总账 when the remembered book is no longer live", async () => {
    await getTestDb()
      .update(books)
      .set({ archivedAt: new Date() })
      .where(eq(books.id, otherBookId));

    const { view, route } = await loadPage({ page: "stats", bookId: otherBookId });

    expect(view.bookId).toBeNull();
    expect(query(route, "ledger", "enhanced-stats")?.queryKey[2]).toMatchObject({ bookId: null });
  });

  it("prefetches the settings view for 设置", async () => {
    const { route } = await loadPage({ page: "settings" });

    expect(route.queries.map((candidate) => candidate.queryKey)).toEqual([["ledger", "settings"]]);
    expect(route.queries[0]?.state.status).toBe("success");
  });

  it("keeps the remembered book when the books fail", async () => {
    request.failBooks = true;

    const { view, books, shell, route } = await loadPage({ page: "records", bookId: otherBookId });

    // A list that failed is not evidence the book is gone; losing it would
    // quietly reset the reader to 总账.
    expect(view.bookId).toBe(otherBookId);
    expect(view.books).toBeNull();
    expect(query(route, "ledger", "source-documents", "stream")?.queryKey[3]).toMatchObject({
      bookId: otherBookId,
    });
    expect(books.queries).toEqual([]);
    expect(query(shell, "ledger", "categories")?.state.data).toEqual([
      expect.objectContaining({ name: "吃喝" }),
    ]);
  });
});
