import { describe, expect, it } from "vitest";
import {
  decodeSourceDocumentStreamCursor,
  encodeSourceDocumentPageCursor,
  encodeSourceDocumentStreamCursor,
} from "@/modules/source-document/stream-cursor";

const page = {
  documentDate: "2026-08-05",
  createdAt: "2026-08-06T01:02:03.000Z",
  id: "00000000-0000-4000-8000-000000000001",
};
const pageCursor = encodeSourceDocumentPageCursor(page);
const filterHash = "0123456789abcdef";

describe("source document stream cursor", () => {
  it("round-trips the generation, filter hash, and page position", () => {
    const cursor = encodeSourceDocumentStreamCursor("42", filterHash, pageCursor);

    expect(cursor).toBe(`v4|42|${filterHash}|${pageCursor}`);
    expect(decodeSourceDocumentStreamCursor(cursor)).toEqual({
      generation: "42",
      filterHash,
      page,
    });
  });

  it("keeps microseconds and still accepts an older millisecond page", () => {
    const micro = { ...page, createdAt: "2026-08-06T01:02:03.123456Z" };
    const cursor = encodeSourceDocumentStreamCursor(
      "42",
      filterHash,
      encodeSourceDocumentPageCursor(micro)
    );

    expect(decodeSourceDocumentStreamCursor(cursor)?.page).toEqual(micro);
    expect(
      decodeSourceDocumentStreamCursor(`v4|42|${filterHash}|${pageCursor}`)?.page.createdAt
    ).toBe("2026-08-06T01:02:03.000Z");
  });

  it("encodes nothing without a valid page cursor", () => {
    expect(encodeSourceDocumentStreamCursor("42", filterHash, null)).toBeNull();
    expect(encodeSourceDocumentStreamCursor("42", filterHash, "not-a-page")).toBeNull();
  });

  it("rejects a cursor from the previous version that carried a ledger id", () => {
    const previous = `v3|00000000-0000-4000-8000-000000000002|42|${filterHash}|${pageCursor}`;

    expect(decodeSourceDocumentStreamCursor(previous)).toBeNull();
  });

  it.each([
    ["an empty cursor", ""],
    ["a missing cursor", null],
    ["an unknown version", `v5|42|${filterHash}|${pageCursor}`],
    ["a non-numeric generation", `v4|abc|${filterHash}|${pageCursor}`],
    ["a malformed filter hash", `v4|42|XYZ|${pageCursor}`],
    ["a missing page", `v4|42|${filterHash}`],
    ["an invalid page date", `v4|42|${filterHash}|2026-8-5|${page.createdAt}|${page.id}`],
    ["a non-ISO page timestamp", `v4|42|${filterHash}|${page.documentDate}|Aug 6 2026|${page.id}`],
    ["an extra page segment", `v4|42|${filterHash}|${pageCursor}|extra`],
    ["garbage", "not-a-cursor"],
  ])("rejects %s", (_label, cursor) => {
    expect(decodeSourceDocumentStreamCursor(cursor)).toBeNull();
  });
});
