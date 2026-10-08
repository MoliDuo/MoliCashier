import { afterAll, afterEach, beforeAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/** Units of each currency one euro buys on every day the mocked provider answers. */
export const TEST_PER_EUR = {
  USD: 1,
  AUD: 1.5,
  BRL: 6,
  CAD: 1.4,
  CHF: 1,
  CNY: 8,
  CZK: 25,
  DKK: 7.5,
  GBP: 0.85,
  HKD: 8.5,
  HUF: 400,
  IDR: 17000,
  ILS: 4,
  INR: 90,
  ISK: 150,
  JPY: 160,
  KRW: 1500,
  MXN: 20,
  MYR: 5,
  NOK: 12,
  NZD: 1.7,
  PHP: 60,
  PLN: 4.5,
  RON: 5,
  SEK: 12,
  SGD: 1.5,
  THB: 40,
  TRY: 40,
  ZAR: 20,
};

const server = setupServer(
  http.all("https://api.openai.com/*", () =>
    HttpResponse.json({ error: { message: "Test provider unavailable" } }, { status: 503 })
  ),
  http.get("https://api.frankfurter.app/:range", ({ params }) => {
    // A time series answers every calendar day in the range with the same
    // publication, so every day the code asks for is final.
    const [start, end] = String(params.range).split("..");
    const days: Record<string, typeof TEST_PER_EUR> = {};
    for (
      let day = new Date(`${start}T00:00:00.000Z`);
      day <= new Date(`${end ?? start}T00:00:00.000Z`);
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      days[day.toISOString().slice(0, 10)] = TEST_PER_EUR;
    }
    return HttpResponse.json({ base: "EUR", start_date: start, end_date: end, rates: days });
  })
);
/** For a test that talks to a provider it started itself on this machine. */
export const testNetwork = server;

const unexpectedRequests: Error[] = [];

export function createUnexpectedHttpError(request: Pick<Request, "method" | "url">): Error {
  let origin = "invalid-origin";
  try {
    origin = new URL(request.url).origin;
  } catch {}
  return new Error(`TEST_UNEXPECTED_HTTP ${request.method.toUpperCase()} ${origin}`);
}

export function takeUnexpectedHttpErrors(): Error[] {
  return unexpectedRequests.splice(0);
}

beforeAll(() => {
  server.listen({
    onUnhandledRequest(request) {
      const error = createUnexpectedHttpError(request);
      unexpectedRequests.push(error);
      throw error;
    },
  });
});

afterEach(() => {
  server.resetHandlers();
  const errors = takeUnexpectedHttpErrors();
  if (errors.length > 0) throw errors[0];
});

afterAll(() => {
  server.close();
  takeUnexpectedHttpErrors();
});
