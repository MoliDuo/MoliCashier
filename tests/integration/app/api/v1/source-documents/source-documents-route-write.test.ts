import {
  API_V1_MAX_DECODED_BATCH_BYTES,
  API_V1_MAX_DECODED_IMAGE_BYTES,
} from "@/modules/source-document/api-v1-policy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { POST } from "@/app/api/v1/source-documents/route";
import { GET } from "@/app/api/v1/source-documents/[sourceDocumentId]/route";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { ledgers, serviceCredentials, extractionAttempts, sourceDocuments } from "@/persistence";
import { computeHash, prefixSuffix } from "@/lib/security/service-credential-token";
import { AppError } from "@/lib/errors";

async function validJpegBase64(): Promise<string> {
  const buffer = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
  return buffer.toString("base64");
}

// Hoisted shared memory store so the beforeEach and vi.mock factory share the same Map
const mockR2 = vi.hoisted(() => {
  const files = new Map<string, Buffer>();
  let uploadError: unknown = null;
  return {
    files,
    setUploadError: (error: unknown) => {
      uploadError = error;
    },
    getStorage: () => ({
      upload: async (key: string, data: Buffer) => {
        if (uploadError != null) throw uploadError;
        files.set(key, Buffer.from(data));
      },
      download: async (key: string) => {
        const data = files.get(key);
        if (data == null) throw new Error("File not found");
        return Buffer.from(data);
      },
      delete: async (key: string) => {
        files.delete(key);
        return { success: true };
      },
    }),
    R2StorageProvider: class {
      async upload(key: string, data: Buffer) {
        if (uploadError != null) throw uploadError;
        files.set(key, Buffer.from(data));
      }
      async download(key: string) {
        const data = files.get(key);
        if (data == null) throw new Error("File not found");
        return Buffer.from(data);
      }
      async delete(key: string) {
        files.delete(key);
        return { success: true };
      }
    },
  };
});

vi.mock("@/lib/storage/s3", () => ({
  S3StorageProvider: mockR2.R2StorageProvider,
  getS3Storage: mockR2.getStorage,
}));

describe("API v1 source-documents route", () => {
  let credentialKey: string;

  beforeEach(async () => {
    const db = getTestDb();
    mockR2.files.clear();
    mockR2.setUploadError(null);

    await db.delete(ledgers);
    await createTestLedger(db);

    credentialKey = `sk_route_${crypto.randomUUID().replace(/-/g, "")}`;
    const { prefix, suffix } = prefixSuffix(credentialKey);
    await db
      .insert(serviceCredentials)
      .values({
        name: "Route Credential",
        tokenHash: computeHash(credentialKey),
        bookId: await testBookId(db),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
  });

  it("POST /api/v1/source-documents returns 201 for valid credential request", async () => {
    const image = await validJpegBase64();
    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentialKey}`,
      },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const data = await response.json();
    expect(data.status).toBe("processing");
    expect(data.revisionState).toBe("processing");
    expect(data.sourceDocumentId).toEqual(expect.any(String));
    expect(data.revisionId).toEqual(expect.any(String));
    expect(response.headers.get("location")).toBe(
      `/api/v1/source-documents/${data.sourceDocumentId}`
    );

    const db = getTestDb();
    const created = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    expect(created).toBeDefined();
  });

  it("dates a document from the server clock when the credential sends no date", async () => {
    const image = await validJpegBase64();
    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${credentialKey}` },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const data = await response.json();

    // An API key belongs to a person but is not that person's device: the
    // record is dated today in the ledger's zone.
    const db = getTestDb();
    const created = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, data.revisionId),
    });
    const [ledger] = await db.select({ timeZone: ledgers.timeZone }).from(ledgers);
    expect(created?.requestedDate).toBe(ledgerToday(ledger!.timeZone));
  });

  it("creates one document, attempt, and processing job for concurrent idempotent requests", async () => {
    const image = await validJpegBase64();
    const makeRequest = () =>
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentialKey}`,
          "Idempotency-Key": "same-ingestion-request",
        },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      });

    const [first, second] = await Promise.all([POST(makeRequest()), POST(makeRequest())]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
    expect(secondBody).toEqual(firstBody);

    const db = getTestDb();
    const documents = await db.select({ id: sourceDocuments.id }).from(sourceDocuments);
    const attempts = await db
      .select({ id: extractionAttempts.id })
      .from(extractionAttempts)
      .where(eq(extractionAttempts.sourceDocumentId, firstBody.sourceDocumentId));
    // The submitted attempt is the document's queued processing attempt.
    const queued = await db
      .select({ attemptId: sourceDocuments.latestAttemptId })
      .from(sourceDocuments)
      .where(eq(sourceDocuments.id, firstBody.sourceDocumentId));
    expect(documents).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    expect(queued).toEqual([{ attemptId: firstBody.revisionId }]);
  });

  it("returns X-Request-Id on error responses too", async () => {
    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentialKey}`,
      },
      body: JSON.stringify({
        images: [{ data: "!!!invalid-base64!!!", mimeType: "image/jpeg" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const missing = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${crypto.randomUUID()}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: crypto.randomUUID() }) }
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accepts the largest legal decoded image through the request-body boundary", async () => {
    const small = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const padded = Buffer.concat([
      small,
      Buffer.alloc(API_V1_MAX_DECODED_IMAGE_BYTES - small.length),
    ]);
    expect(padded.length).toBe(API_V1_MAX_DECODED_IMAGE_BYTES);

    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${credentialKey}` },
      body: JSON.stringify({
        images: [{ data: padded.toString("base64"), mimeType: "image/jpeg" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const db = getTestDb();
    const documents = await db.select({ id: sourceDocuments.id }).from(sourceDocuments);
    expect(documents).toHaveLength(1);
  });

  it("rejects a decoded batch above 24 MiB with 400", async () => {
    const half = Buffer.alloc(API_V1_MAX_DECODED_BATCH_BYTES / 2 + 1).toString("base64");
    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${credentialKey}` },
      body: JSON.stringify({
        images: [
          { data: half, mimeType: "image/jpeg" },
          { data: half, mimeType: "image/jpeg" },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Decoded image batch exceeds 24 MiB" }),
      ])
    );
  });

  it("rejects a request body above the wire limit with 413", async () => {
    const { API_V1_MAX_REQUEST_BYTES } = await import("@/modules/source-document/api-v1-policy");
    const image = await validJpegBase64();
    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentialKey}`,
        "content-length": String(API_V1_MAX_REQUEST_BYTES + 1),
      },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a credential past its per-minute allowance with 429 and Retry-After, unread", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const submit = (body: BodyInit) =>
        POST(
          new NextRequest("http://localhost/api/v1/source-documents", {
            method: "POST",
            headers: { Authorization: `Bearer ${credentialKey}` },
            body,
            duplex: "half",
          } as ConstructorParameters<typeof NextRequest>[1])
        );
      // Every request counts, the ones that then fail validation included.
      for (let i = 0; i < 30; i++) expect((await submit("{}")).status).toBe(400);

      let pulled = false;
      const response = await submit(
        new ReadableStream<Uint8Array>(
          {
            pull() {
              pulled = true;
              throw new Error("request body was consumed");
            },
          },
          { highWaterMark: 0 }
        )
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
      expect(pulled).toBe(false);

      vi.setSystemTime(Date.now() + 2_000);
      expect((await submit("{}")).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a request without a valid credential before reading its body", async () => {
    let pulled = false;
    const response = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer not-a-credential" },
        body: new ReadableStream<Uint8Array>(
          {
            pull() {
              pulled = true;
              throw new Error("request body was consumed");
            },
          },
          { highWaterMark: 0 }
        ),
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1])
    );

    expect(response.status).toBe(401);
    expect(pulled).toBe(false);
  });

  it("maps storage failures to 503 and still returns X-Request-Id", async () => {
    const image = await validJpegBase64();
    mockR2.setUploadError(new AppError("Failed to upload file to S3", "S3_UPLOAD_FAILED", 503));

    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${credentialKey}` },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    mockR2.setUploadError(null);
  });

  it("normalizes equivalent Base64 for idempotency and rejects different image content", async () => {
    const image = await validJpegBase64();
    const key = "content-aware-request";
    const submit = (data: string) =>
      POST(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentialKey}`,
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ images: [{ data, mimeType: "image/jpeg" }] }),
        })
      );
    const first = await submit(image);
    const equivalent = `data:image/jpeg;base64,${image.replace(/=/g, "").replace(/(.{40})/g, "$1\n")}`;
    const second = await submit(equivalent);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());

    const different = (
      await sharp({
        create: { width: 2, height: 1, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const conflict = await submit(different);
    expect(conflict.status).toBe(409);
  });

  it("rejects an unusable Idempotency-Key before reading the request body", async () => {
    // A body that fails as soon as it is pulled: had the route read it first,
    // this error would surface instead of the key's validation failure.
    const unreadableBody = () =>
      new ReadableStream<Uint8Array>({
        pull() {
          throw new Error("request body was consumed");
        },
      });

    const submit = (key: string) =>
      POST(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${credentialKey}`, "Idempotency-Key": key },
          body: unreadableBody(),
          duplex: "half",
        } as ConstructorParameters<typeof NextRequest>[1])
      );

    for (const key of ["k".repeat(513), " ".repeat(513)]) {
      expect((await submit(key)).status).toBe(400);
    }
    // With a legal key the route does read the body, and fails differently.
    expect((await submit("legal-key")).status).not.toBe(400);
    expect(await getTestDb().select().from(sourceDocuments)).toEqual([]);
  });

  it("keys a replay on the header exactly as sent, up to its longest legal length", async () => {
    const image = await validJpegBase64();
    const submit = (key: string) =>
      POST(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${credentialKey}`, "Idempotency-Key": key },
          body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
        })
      );
    const longest = "k".repeat(512);

    const first = await submit(longest);
    const replay = await submit(longest);
    const otherKey = await submit("key with inner spaces");

    expect(first.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(otherKey.status).toBe(201);
    expect(await getTestDb().select().from(sourceDocuments)).toHaveLength(2);
  });

  it("replays a repeated key with the record's status as it is now", async () => {
    const image = await validJpegBase64();
    const submit = () =>
      POST(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${credentialKey}`, "Idempotency-Key": "finished" },
          body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
        })
      );
    const first = await submit().then((response) => response.json());
    await getTestDb()
      .update(extractionAttempts)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(extractionAttempts.id, first.revisionId));

    const replay = await submit();

    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({
      sourceDocumentId: first.sourceDocumentId,
      revisionId: first.revisionId,
      revisionState: "completed",
      status: "completed",
    });
  });
});
