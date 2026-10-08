import "server-only";
import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { omitUndefinedProperties, UUID_REGEX } from "@/lib/validation";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { parseBookId, parseLedgerEntryIds } from "@/modules/ledger/contract-schemas";
import { getBatchEntryDateImpact } from "@/modules/ledger/server/entry-reads/get-batch-entry-date-impact";
import { withResolvedPeriod, withResolvedStatsPeriod } from "@/modules/ledger/server/query-period";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import {
  getBookIncludingArchived,
  listBooks,
  listBooksIncludingArchived,
} from "@/modules/ledger/server/books";
import { listCategoriesWithCount } from "@/modules/ledger/server/categories";
import { getLedgerSettingsView } from "@/modules/ledger/server/get-ledger-settings";
import { getLatestCategoryAssignmentJobDto } from "@/modules/ledger/server/get-category-assignment-job";
import {
  listCategoryAssignmentEntryStates,
  listCategoryAssignmentResults,
} from "@/server/category-assignment/assignments";
import {
  sourceDocumentIdSchema,
  sourceDocumentIdsSchema,
  streamPageInputSchema,
  streamTotalInputSchema,
} from "@/modules/source-document/contract-schemas";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";
import { getStreamRefresh } from "@/modules/source-document/server/stream-refresh";
import {
  findEarliestDocumentDate,
  queryEnhancedStats,
} from "@/modules/stats/server/enhanced-stats-query";
import { parseEnhancedStatsInput } from "@/modules/stats/contract-schemas";
import { parseConvertCurrencyInput } from "@/modules/currency/contract-schemas";
import { convertCurrency } from "@/modules/currency/server/convert-currency";
import { getPeriodForecast } from "@/modules/forecast/server/get-forecast";
import { previewSourceDocumentDateImpact } from "./source-document-date-impact";

/**
 * What every read runs against: the signed-in session's ledger. The caller
 * (the `/api/ledger-queries` route, or the page bootstrap) has already settled
 * who is asking and loaded the ledger, once.
 */
export interface LedgerQueryContext {
  ledger: LedgerDto;
}

/**
 * One typed read. `parse` is the read's schema: it turns the browser's raw input
 * into the read's input, resolving a semantic period against the ledger's zone
 * first where the read has one. `run` reads with the parsed input.
 */
interface LedgerQuery<TInput, TResult> {
  /** The read takes no input, and refuses one. */
  noInput?: true;
  parse: (raw: unknown, context: LedgerQueryContext) => TInput | Promise<TInput>;
  run: (input: TInput, context: LedgerQueryContext) => Promise<TResult>;
}

const defineQuery = <TInput, TResult>(query: LedgerQuery<TInput, TResult>) => query;

/** A read that takes no input. */
const noInput = <TResult>(run: (context: LedgerQueryContext) => Promise<TResult>) =>
  defineQuery<undefined, TResult>({
    noInput: true,
    parse: () => undefined,
    run: (_input, context) => run(context),
  });

const timeZoneOf = (context: LedgerQueryContext) => context.ledger.settings.timeZone;

/** The stats read's book, if it names one, is a book id before anything queries with it. */
const statsScopeSchema = z.looseObject({
  bookId: z.string().regex(UUID_REGEX, "Invalid book").optional(),
});

const refreshInputSchema = z.object({ afterVersion: z.string().regex(/^\d+$/) });

const categoryAssignmentResultsInputSchema = z
  .object({
    jobId: z.string().uuid(),
    cursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const sourceDocumentDateImpactInputSchema = z.object({
  sourceDocumentIds: sourceDocumentIdsSchema,
  ledgerEntryIds: z.array(z.unknown()),
});

const categoryAssignmentEntryStatesInputSchema = z.object({ jobId: z.string().uuid() }).strict();

/**
 * Every browser read, by the name `postLedgerQuery` sends. The route and the
 * page bootstrap both run reads through here, so a prefetched page and the
 * browser's own read of it parse and resolve the same way.
 */
export const ledgerQueries = {
  detail: defineQuery({
    parse: (raw) => sourceDocumentIdSchema.parse(raw),
    run: (id) => getTargetSourceDocument(id),
  }),
  stream: defineQuery({
    parse: (raw, context) => {
      const parsed = streamPageInputSchema.parse(withResolvedPeriod(raw, timeZoneOf(context)));
      return { ...omitUndefinedProperties(parsed), limit: parsed.limit };
    },
    run: (input) => listStreamPage(input),
  }),
  total: defineQuery({
    parse: (raw, context) =>
      omitUndefinedProperties(
        streamTotalInputSchema.parse(withResolvedPeriod(raw, timeZoneOf(context)))
      ),
    run: (input) => getStreamTotal(input),
  }),
  refresh: defineQuery({
    parse: (raw) => refreshInputSchema.parse(raw),
    run: (input) => getStreamRefresh(input),
  }),
  entries: defineQuery({
    // listLedgerEntries validates its own input, after the period is resolved.
    parse: (raw, context) => withResolvedPeriod(raw, timeZoneOf(context)),
    run: (input) => listLedgerEntries(input),
  }),
  summary: defineQuery({
    // calculateLedgerStats validates its own input; no input is the whole ledger.
    parse: (raw, context) => withResolvedPeriod(raw ?? {}, timeZoneOf(context)),
    run: (input) => calculateLedgerStats(input),
  }),
  stats: defineQuery({
    parse: async (raw, context) => {
      // The book is checked before the period is resolved, which reads the
      // earliest record of that book.
      statsScopeSchema.parse(raw);
      return parseEnhancedStatsInput(
        await withResolvedStatsPeriod(raw, timeZoneOf(context), (bookId) =>
          findEarliestDocumentDate(bookId)
        )
      );
    },
    run: (input) => queryEnhancedStats(input),
  }),
  forecast: defineQuery({
    parse: (raw) => raw,
    run: (input, context) => getPeriodForecast(input, timeZoneOf(context)),
  }),
  ledger: noInput(async (context) => context.ledger),
  books: noInput(() => listBooks()),
  "books-including-archived": noInput(() => listBooksIncludingArchived()),
  book: defineQuery({
    parse: (raw) => parseBookId(raw),
    run: (bookId) => getBookIncludingArchived(bookId),
  }),
  categories: noInput(() => listCategoriesWithCount()),
  settings: noInput(() => getLedgerSettingsView()),
  "category-assignment": noInput(() => getLatestCategoryAssignmentJobDto()),
  "category-assignment-results": defineQuery({
    parse: (raw) => {
      const { jobId, cursor, limit } = categoryAssignmentResultsInputSchema.parse(raw);
      return {
        jobId,
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit }),
      };
    },
    run: (input) => listCategoryAssignmentResults(input),
  }),
  "category-assignment-entry-states": defineQuery({
    parse: (raw) => categoryAssignmentEntryStatesInputSchema.parse(raw),
    run: (input) => listCategoryAssignmentEntryStates(input),
  }),
  "source-document-input": defineQuery({
    parse: (raw) => sourceDocumentIdSchema.parse(raw),
    run: async (id) => {
      const document = await getSourceDocumentInput(id);
      if (document == null) throw new NotFoundError("Source document");
      return document;
    },
  }),
  /** What moving the selected entries to another day touches: their whole documents. */
  "batch-entry-date-impact": defineQuery({
    parse: (raw) => parseLedgerEntryIds(raw),
    run: (ledgerEntryIds) => getBatchEntryDateImpact({ ledgerEntryIds }),
  }),
  /** The same preview for a mixed selection of documents and entries. */
  "source-document-date-impact": defineQuery({
    parse: (raw) => {
      // The input is checked before any of it is read: a request without an id
      // list is a validation failure, not a TypeError.
      const parsed = sourceDocumentDateImpactInputSchema.parse(raw);
      return {
        sourceDocumentIds: parsed.sourceDocumentIds,
        // A selection of documents without entries has no entry ids, and still moves.
        ledgerEntryIds:
          parsed.ledgerEntryIds.length === 0 ? [] : parseLedgerEntryIds(parsed.ledgerEntryIds),
      };
    },
    run: (input) => previewSourceDocumentDateImpact(input),
  }),
  "convert-currency": defineQuery({
    parse: (raw) => parseConvertCurrencyInput(raw),
    run: (input, context) => convertCurrency(input, timeZoneOf(context)),
  }),
};

export type LedgerQueryName = keyof typeof ledgerQueries;

type LedgerQueryResult<TName extends LedgerQueryName> = Awaited<
  ReturnType<(typeof ledgerQueries)[TName]["run"]>
>;

export const LEDGER_QUERY_NAMES = Object.keys(ledgerQueries) as [
  LedgerQueryName,
  ...LedgerQueryName[],
];

/** Whether the read refuses any input. */
export function takesNoInput(name: LedgerQueryName): boolean {
  return (ledgerQueries[name] as { noInput?: true }).noInput === true;
}

/** Parses the raw input for the named read, then runs it. */
export async function runLedgerQuery<TName extends LedgerQueryName>(
  name: TName,
  raw: unknown,
  context: LedgerQueryContext
): Promise<LedgerQueryResult<TName>> {
  // The names and their definitions line up by construction; TypeScript cannot
  // follow the correlation through the index, so the definition is widened here.
  const query = ledgerQueries[name] as unknown as LedgerQuery<unknown, LedgerQueryResult<TName>>;
  return query.run(await query.parse(raw, context), context);
}
