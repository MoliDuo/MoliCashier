import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, NotFoundError } from "@/lib/errors";
import { omitUndefinedProperties } from "@/lib/validation";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { getSourceDocumentDetailAction } from "@/modules/source-document/server/get-document-detail";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";
import { getStreamRefresh } from "@/modules/source-document/server/stream-refresh";
import {
  sourceDocumentIdSchema,
  streamPageInputSchema,
  streamTotalInputSchema,
} from "@/modules/source-document/contract-schemas";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { withResolvedPeriod, withResolvedStatsPeriod } from "@/modules/ledger/server/query-period";
import { getLedgerAction } from "@/modules/ledger/server/get-ledger";
import {
  getBookAction,
  getBooksAction,
  getBooksIncludingArchivedAction,
} from "@/modules/ledger/server/list-books";
import { getEntryCategoriesAction } from "@/modules/ledger/server/list-categories";
import { getLedgerSettingsAction } from "@/modules/ledger/server/get-ledger-settings";
import {
  getCategoryAssignmentEntryStatesAction,
  getCategoryAssignmentResultsAction,
  getCategoryAssignmentJobAction,
} from "@/modules/ledger/server/get-category-assignment-job";
import {
  findEarliestDocumentDate,
  queryEnhancedStats,
} from "@/modules/stats/server/enhanced-stats-query";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import { convertCurrency } from "@/modules/currency/server/convert-currency";
import { parseEnhancedStatsInput } from "@/modules/stats/contract-schemas";

const requestSchema = z
  .object({
    query: z.enum([
      "detail",
      "stream",
      "total",
      "refresh",
      "entries",
      "ledger",
      "books",
      "books-including-archived",
      "book",
      "categories",
      "summary",
      "settings",
      "stats",
      "category-assignment",
      "category-assignment-results",
      "category-assignment-entry-states",
      "source-document-input",
      "convert-currency",
    ]),
    args: z.array(z.unknown()).max(1),
  })
  .strict();

/** The reads that take no input: the ledger itself is resolved from the session. */
const noArgumentsSchema = z.array(z.unknown()).length(0);

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  }
  try {
    const payload = requestSchema.parse(await request.json());
    const input = payload.args[0];
    let result: unknown;
    switch (payload.query) {
      case "stats": {
        const { ledger } = await requireLedgerAccess();
        const resolved = await withResolvedStatsPeriod(input, ledger.settings.timeZone, (bookId) =>
          findEarliestDocumentDate(bookId)
        );
        result = await queryEnhancedStats(parseEnhancedStatsInput(resolved));
        break;
      }
      case "detail":
        result = await getSourceDocumentDetailAction(sourceDocumentIdSchema.parse(input));
        break;
      case "stream": {
        const { ledger } = await requireLedgerAccess();
        const parsed = streamPageInputSchema.parse(
          withResolvedPeriod(input, ledger.settings.timeZone)
        );
        result = await listStreamPage({
          ...omitUndefinedProperties(parsed),
          limit: parsed.limit,
        });
        break;
      }
      case "total": {
        const { ledger } = await requireLedgerAccess();
        const parsed = omitUndefinedProperties(
          streamTotalInputSchema.parse(withResolvedPeriod(input, ledger.settings.timeZone))
        );
        result = await getStreamTotal(parsed);
        break;
      }
      case "refresh": {
        const parsed = z.object({ afterVersion: z.string().regex(/^\d+$/) }).parse(input);
        await requireLedgerAccess();
        result = await getStreamRefresh(parsed);
        break;
      }
      case "source-document-input": {
        const id = sourceDocumentIdSchema.parse(input);
        await requireLedgerAccess();
        const document = await getSourceDocumentInput(id);
        if (document == null) throw new NotFoundError("Source document");
        result = document;
        break;
      }
      case "convert-currency":
        result = await convertCurrency(input);
        break;
      case "entries": {
        const { ledger } = await requireLedgerAccess();
        result = await listLedgerEntries(withResolvedPeriod(input, ledger.settings.timeZone));
        break;
      }
      case "ledger":
        noArgumentsSchema.parse(payload.args);
        result = await getLedgerAction();
        break;
      case "books":
        noArgumentsSchema.parse(payload.args);
        result = await getBooksAction();
        break;
      case "books-including-archived":
        noArgumentsSchema.parse(payload.args);
        result = await getBooksIncludingArchivedAction();
        break;
      case "book":
        result = await getBookAction(input);
        break;
      case "categories":
        noArgumentsSchema.parse(payload.args);
        result = await getEntryCategoriesAction();
        break;
      case "summary": {
        const { ledger } = await requireLedgerAccess();
        result = await calculateLedgerStats(
          withResolvedPeriod(input ?? {}, ledger.settings.timeZone)
        );
        break;
      }
      case "settings":
        noArgumentsSchema.parse(payload.args);
        result = await getLedgerSettingsAction();
        break;
      case "category-assignment": {
        noArgumentsSchema.parse(payload.args);
        result = await getCategoryAssignmentJobAction();
        break;
      }
      case "category-assignment-results":
        result = await getCategoryAssignmentResultsAction(
          z
            .object({
              jobId: z.string().uuid(),
              cursor: z.number().int().nonnegative().optional(),
              limit: z.number().int().min(1).max(50).optional(),
            })
            .strict()
            .parse(input) as { jobId: string; cursor?: number; limit?: number }
        );
        break;
      case "category-assignment-entry-states":
        result = await getCategoryAssignmentEntryStatesAction(
          z.object({ jobId: z.string().uuid() }).strict().parse(input) as { jobId: string }
        );
        break;
    }
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.statusCode
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    return NextResponse.json(
      { error: status === 500 ? "INTERNAL_ERROR" : "QUERY_FAILED" },
      { status, headers }
    );
  }
}
