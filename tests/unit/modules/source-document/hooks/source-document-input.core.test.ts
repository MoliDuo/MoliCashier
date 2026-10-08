import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSubmitPayload,
  createSubmissionsEqual,
  parseStoredInputDraft,
  sourceDocumentPayloadsEqual,
  submitErrorMessageKey,
} from "@/modules/source-document/hooks/source-document-input.core";
import { SourceDocumentSubmissionUploadError } from "@/modules/source-document/hooks/source-document-submission-upload";

describe("buildSubmitPayload local business date", () => {
  it("submits the chosen date and no device zone; the ledger's zone dates the record", () => {
    const payload = buildSubmitPayload("receipt", [], new Date(2026, 6, 27, 0, 30));
    expect(payload).toMatchObject({ text: "receipt", documentDate: "2026-07-27" });
    expect(payload).not.toHaveProperty("timezone");
  });

  it("sends new files for upload and keeps already stored ones by id", () => {
    const file = new File(["x"], "receipt.png", { type: "image/png" });
    const payload = buildSubmitPayload(
      "",
      [
        { data: "blob:new", mimeType: "image/png", file },
        { data: "https://stored", mimeType: "image/jpeg", storedFileId: "stored-1" },
      ],
      new Date(2026, 6, 27)
    );

    expect(payload).toEqual({
      documentDate: "2026-07-27",
      text: null,
      images: [{ file, mimeType: "image/png" }],
      storedFileIds: ["stored-1"],
    });
  });
});

describe("sourceDocumentPayloadsEqual", () => {
  const file = new File(["x"], "receipt.png", { type: "image/png" });
  const payload = {
    documentDate: "2026-07-17",
    text: "Lunch",
    storedFileIds: ["stored-1"],
    images: [{ file, mimeType: "image/png" }],
  };

  it("matches a rebuilt payload with the same files", () => {
    expect(
      sourceDocumentPayloadsEqual(payload, {
        ...payload,
        storedFileIds: [...payload.storedFileIds],
        images: [{ file, mimeType: "image/png" }],
      })
    ).toBe(true);
  });

  it("tells apart a different text, stored file or picked file", () => {
    expect(sourceDocumentPayloadsEqual(payload, { ...payload, text: "Dinner" })).toBe(false);
    expect(sourceDocumentPayloadsEqual(payload, { ...payload, storedFileIds: [] })).toBe(false);
    expect(
      sourceDocumentPayloadsEqual(payload, {
        ...payload,
        images: [{ file: new File(["x"], "receipt.png"), mimeType: "image/png" }],
      })
    ).toBe(false);
  });
});

describe("parseStoredInputDraft", () => {
  it("accepts text with a picked calendar day or the default date", () => {
    expect(parseStoredInputDraft({ text: "午饭", entryDate: "2026-07-17" })).toEqual({
      text: "午饭",
      entryDate: "2026-07-17",
    });
    expect(parseStoredInputDraft({ text: "", entryDate: null })).toEqual({
      text: "",
      entryDate: null,
    });
  });

  it("reads a draft from before dates were stored as days as the day it picked", () => {
    expect(
      parseStoredInputDraft({ text: "午饭", entryDate: new Date(2026, 6, 17).getTime() })
    ).toEqual({ text: "午饭", entryDate: "2026-07-17" });
  });

  it("refuses anything else", () => {
    expect(parseStoredInputDraft(null)).toBeNull();
    expect(parseStoredInputDraft({ text: 1, entryDate: null })).toBeNull();
    expect(parseStoredInputDraft({ text: "", entryDate: Number.NaN })).toBeNull();
    expect(parseStoredInputDraft({ text: "", entryDate: "17/07/2026" })).toBeNull();
    expect(parseStoredInputDraft({ text: "", entryDate: "2026-7-17" })).toBeNull();
  });
});

describe("createSubmissionsEqual", () => {
  const payload = { documentDate: "2026-07-17", text: "Lunch", storedFileIds: [] };

  it("reuses the key only for the same input sent to the same book", () => {
    expect(
      createSubmissionsEqual(
        { bookId: "book-1", payload },
        { bookId: "book-1", payload: { ...payload, storedFileIds: [] } }
      )
    ).toBe(true);
    expect(
      createSubmissionsEqual({ bookId: "book-1", payload }, { bookId: "book-2", payload })
    ).toBe(false);
    expect(createSubmissionsEqual({ bookId: null, payload }, { bookId: "book-1", payload })).toBe(
      false
    );
  });
});

describe("submitErrorMessageKey", () => {
  beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));
  afterEach(() => vi.unstubAllGlobals());

  it("stays quiet about a cancelled upload", () => {
    expect(submitErrorMessageKey(new DOMException("aborted", "AbortError"), "createError")).toBe(
      null
    );
  });

  it("names the upload stage that failed", () => {
    expect(
      submitErrorMessageKey(new SourceDocumentSubmissionUploadError("x", "prepare"), "createError")
    ).toBe("imageReadError");
    expect(
      submitErrorMessageKey(new SourceDocumentSubmissionUploadError("x", "upload"), "createError")
    ).toBe("imageUploadError");
  });

  it("reports a lost connection as a network failure", () => {
    expect(submitErrorMessageKey(new TypeError("Failed to fetch"), "createError")).toBe(
      "networkError"
    );
    expect(submitErrorMessageKey(new Error("fetch failed"), "retryError")).toBe("networkError");
    vi.stubGlobal("navigator", { onLine: false });
    expect(submitErrorMessageKey(new Error("boom"), "createError")).toBe("networkError");
  });

  it("reports a rejected input, and otherwise the mode's own failure", () => {
    expect(submitErrorMessageKey(new Error("text is required"), "createError")).toBe(
      "validationError"
    );
    expect(submitErrorMessageKey(new Error("boom"), "createError")).toBe("createError");
    expect(submitErrorMessageKey(new Error("boom"), "retryError")).toBe("retryError");
  });
});
