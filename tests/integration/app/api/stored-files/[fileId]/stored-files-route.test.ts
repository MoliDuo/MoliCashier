import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, todayUtc } from "tests/helpers/schema-setup";
import { sourceDocumentFiles, sourceDocuments, storedFiles } from "@/persistence";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { AppError } from "@/lib/errors";

const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

vi.mock("@/lib/storage/s3", () => ({
  getS3Storage: () => ({
    upload: vi.fn(),
    download: downloadMock,
    stream: async (key: string) => {
      const bytes: Buffer = await downloadMock(key);
      return new Blob([new Uint8Array(bytes)]).stream();
    },
    delete: vi.fn(async () => ({ success: true })),
  }),
}));

import { GET } from "@/app/api/stored-files/[fileId]/route";

function request(): NextRequest {
  return new Request("http://localhost/api/stored-files/file") as NextRequest;
}

async function createLinkedStoredFile() {
  const db = getTestDb();
  const [document] = await db
    .insert(sourceDocuments)
    .values({
      documentDate: todayUtc(),
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  const [file] = await db
    .insert(storedFiles)
    .values({
      storageKey: "stored/private-file",
      contentType: "image/png",
      byteSize: 5,
    })
    .returning();
  await db.insert(sourceDocumentFiles).values({
    sourceDocumentId: document!.id,
    storedFileId: file!.id,
    position: 0,
  });
  return { document: document!, file: file! };
}

describe("GET /api/stored-files/[fileId]", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    downloadMock.mockReset();
    vi.mocked(getCurrentSession).mockResolvedValue(testSession());
  });

  it("serves trusted bytes without exposing the R2 key", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const { file } = await createLinkedStoredFile();
    downloadMock.mockResolvedValue(Buffer.from("bytes"));

    const response = await GET(request(), { params: Promise.resolve({ fileId: file.id }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).toBe("bytes");
    expect(body).not.toContain(file.storageKey);
  });

  it("serves a file from the live ledger to the live account", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const { file } = await createLinkedStoredFile();

    const response = await GET(request(), { params: Promise.resolve({ fileId: file.id }) });

    expect(response.status).toBe(200);
    expect(downloadMock).toHaveBeenCalled();
  });

  it("returns 404 after the owning source document is deleted", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const { document, file } = await createLinkedStoredFile();
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, document.id));

    const response = await GET(request(), { params: Promise.resolve({ fileId: file.id }) });

    expect(response.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("maps missing S3 objects and S3 outages to controlled responses", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const { file } = await createLinkedStoredFile();

    downloadMock.mockRejectedValueOnce(new AppError("missing", "FILE_NOT_FOUND", 404));
    const missing = await GET(request(), { params: Promise.resolve({ fileId: file.id }) });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(missing.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    downloadMock.mockRejectedValueOnce(new AppError("outage", "S3_DOWNLOAD_FAILED", 503));
    const outage = await GET(request(), { params: Promise.resolve({ fileId: file.id }) });
    expect(outage.status).toBe(503);
    expect(outage.headers.get("cache-control")).toBe("private, no-store");
    await expect(outage.json()).resolves.toMatchObject({
      error: { code: "STORAGE_UNAVAILABLE", details: { correlationId: expect.any(String) } },
    });
  });

  it("returns 401 without authentication", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const response = await GET(request(), {
      params: Promise.resolve({ fileId: crypto.randomUUID() }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
