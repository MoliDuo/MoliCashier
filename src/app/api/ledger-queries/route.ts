import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, ValidationError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";
import { readBoundedBody } from "@/lib/http/bounded-body";
import { requireAuth } from "@/modules/auth/server/session-guards";
import { requireLedger } from "@/modules/ledger/access";
import {
  LEDGER_QUERY_NAMES,
  runLedgerQuery,
  takesNoInput,
} from "@/modules/workspace/server/ledger-queries";

const requestSchema = z
  .object({
    query: z.enum(LEDGER_QUERY_NAMES),
    args: z.array(z.unknown()).max(1),
  })
  .strict();

/** The reads that take no input: the ledger itself is resolved from the session. */
const noArgumentsSchema = z.array(z.unknown()).length(0);

/** A query envelope is a name and a small input; the server-action limit is ample. */
const MAX_BODY_BYTES = 1024 * 1024;

async function readEnvelope(request: Request): Promise<unknown> {
  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (body == null) throw new ValidationError("Request body is empty");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
  } catch {
    throw new ValidationError("Request body is not UTF-8");
  }
  return JSON.parse(text) as unknown;
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  }
  let queryName: string | undefined;
  try {
    // Who is asking is settled before the body is read, so a request without a
    // session is turned away without its body ever being buffered.
    await requireAuth();
    const payload = requestSchema.parse(await readEnvelope(request));
    queryName = payload.query;
    if (takesNoInput(payload.query)) noArgumentsSchema.parse(payload.args);
    // Every read is for the session's ledger, loaded once here.
    const ledger = await requireLedger();
    const result = await runLedgerQuery(payload.query, payload.args[0], { ledger });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.statusCode
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    // A reader that moved on mid-request (a quick tab or period switch) drops the connection while
    // the body is read; nothing failed on this side, so it is not logged as a server error.
    const clientGone =
      request.signal.aborted ||
      (error instanceof Error && (error as Error & { code?: unknown }).code === "ECONNRESET");
    // Only the query's name: its arguments carry search terms and ids.
    if (status === 500 && !clientGone) {
      logError(`ledger-queries:${queryName ?? "unknown"}`, error);
    }
    return NextResponse.json(
      { error: status === 500 ? "INTERNAL_ERROR" : "QUERY_FAILED" },
      { status, headers }
    );
  }
}
