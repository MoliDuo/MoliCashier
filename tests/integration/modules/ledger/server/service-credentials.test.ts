import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as ledgerEntryPOST } from "@/app/api/v1/source-documents/route";
import { getTestDb } from "tests/setup";
import {
  books,
  ledgers,
  serviceCredentials,
  extractionAttempts,
  sourceDocuments,
} from "@/persistence";
import { eq } from "drizzle-orm";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import {
  createServiceCredentialAction,
  deleteServiceCredentialAction,
} from "@/modules/ledger/server-actions/credentials";
import { listServiceCredentials } from "@/modules/ledger/server/service-credentials";
import { getLedgerSettingsView } from "@/modules/ledger/server/get-ledger-settings";
import { getDateInTimezone } from "@/lib/date-utils";
import { ValidationError } from "@/lib/errors";
import { computeHash } from "@/lib/security/service-credential-token";
import sharp from "sharp";

async function validJpegBase64(): Promise<string> {
  return (
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
}

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error(`Expected at least one ${label}`);
  }
  return first;
}

// Mock Processing

const mockR2 = vi.hoisted(() => {
  const files = new Map<string, Buffer>();
  return {
    R2StorageProvider: class {
      async upload(key: string, data: Buffer) {
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
  getS3Storage: () => new mockR2.R2StorageProvider(),
}));

// Mock Task Runtime
// Mock Tasks

/** Creates a key the test expects to be accepted. */
async function createCredential(input: { name: string; bookId: string }) {
  const result = await createServiceCredentialAction(input);
  if (!result.ok) throw new Error(`Expected the key to be created, got ${result.code}`);
  return result.credential;
}

describe("Service Credentials & Ledger Entry Ingestion", () => {
  beforeEach(async () => {
    const db = getTestDb();

    await db.delete(ledgers);
    await createTestLedger(db);
  });

  it("should create and list service credentials via Actions", async () => {
    // Create Credential - returns data with one-time token
    const createRes = await createCredential({
      name: "Test Credential",
      bookId: await testBookId(getTestDb()),
    });

    expect(createRes).toBeDefined();
    expect(createRes.token).toBeDefined();
    expect(createRes.tokenPrefix).toBeDefined();
    expect(createRes.tokenSuffix).toBeDefined();
    expect(createRes.name).toBe("Test Credential");

    // The token should match the expected format
    expect(createRes.token).toMatch(/^sk_live_[0-9a-f]{64}$/);

    // Verify hash is stored, not plaintext
    const db = getTestDb();
    const stored = await db.query.serviceCredentials.findFirst({
      where: eq(serviceCredentials.id, createRes.id),
    });
    expect(stored?.tokenHash).toBeDefined();
    expect(stored).not.toHaveProperty("key");
    expect(computeHash(createRes.token)).toBe(stored?.tokenHash);

    // List Credentials
    const listRes = await listServiceCredentials();
    const listedCredential = requireFirst(listRes, "service credential");

    expect(listRes).toHaveLength(1);
    expect(listedCredential.id).toBe(createRes.id);
    // List should not include the full token
    expect((listedCredential as Record<string, unknown>).key).toBeUndefined();
    expect((listedCredential as Record<string, unknown>).token).toBeUndefined();
    // List should include prefix/suffix
    expect(listedCredential.tokenPrefix).toBe(createRes.tokenPrefix);
    expect(listedCredential.tokenSuffix).toBe(createRes.tokenSuffix);
  });

  it("refuses a blank credential name with a code", async () => {
    await expect(
      createServiceCredentialAction({
        name: "",
        bookId: await testBookId(getTestDb()),
      } as never)
    ).resolves.toEqual({ ok: false, code: "invalid" });
  });

  it("names a book that is not available apart from the key limit", async () => {
    await expect(
      createServiceCredentialAction({ name: "Lost book", bookId: crypto.randomUUID() })
    ).resolves.toEqual({ ok: false, code: "book_unavailable" });

    const bookId = await testBookId(getTestDb());
    for (let index = 0; index < 20; index += 1) {
      await createCredential({ name: `Key ${index}`, bookId });
    }
    await expect(createServiceCredentialAction({ name: "One too many", bookId })).resolves.toEqual({
      ok: false,
      code: "limit_reached",
    });
  });

  it("rejects invalid credential id with ValidationError", async () => {
    await expect(deleteServiceCredentialAction("bad-id")).rejects.toThrow(ValidationError);
  });

  it("should ingest ledger entry with valid service credential", async () => {
    // Setup: create a hash-only credential with a known bearer token.
    const db = getTestDb();
    const knownToken = "sk_test_123";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    const hash = computeHash(knownToken);
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        name: "Ingest Credential",
        tokenHash: hash,
        bookId: await testBookId(db),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const image = await validJpegBase64();
    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${knownToken}`,
      },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("processing");

    // Check DB
    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    expect(doc).toBeDefined();
    expect(doc?.bookId).toBe(await testBookId(db));
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.sourceDocumentId, data.sourceDocumentId),
    });
    expect(doc?.inputText).toBeNull();
    expect(attempt?.status).toBe("processing");
  });

  it("should reject ledger entry with invalid service credential", async () => {
    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer invalid_key`,
      },
      body: JSON.stringify({ text: "API Ledger Entry" }),
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(401);
  });

  it("should reject invalid JSON body", async () => {
    const db = getTestDb();
    const knownToken = "sk_invalid_json";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    const hash = computeHash(knownToken);
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        name: "Broken Body Credential",
        tokenHash: hash,
        bookId: await testBookId(db),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${knownToken}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("VALIDATION_FAILED");
  });

  it("should derive entryDate when entryDate is omitted", async () => {
    const db = getTestDb();
    const knownToken = "sk_timezone";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    const hash = computeHash(knownToken);
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        name: "Timezone Credential",
        tokenHash: hash,
        bookId: await testBookId(db),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const image = await validJpegBase64();
    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${knownToken}`,
      },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, doc!.latestAttemptId!),
    });

    // Without a day of its own, the upload is dated today in the ledger's zone.
    const [ledger] = await db.select({ timeZone: ledgers.timeZone }).from(ledgers);
    expect(attempt?.requestedDate).toBe(getDateInTimezone(ledger!.timeZone));
    // The record is dated from the start, not only once processing succeeds.
    expect(doc?.documentDate).toBe(attempt?.requestedDate);
  });

  it("files an upload into its key's book, dated in the ledger's zone", async () => {
    const db = getTestDb();
    const knownToken = "sk_book_zone";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    // The ledger keeps one zone for every book; UTC+14 is a day ahead of the
    // default zone for ten hours of each day, which is when this would catch a
    // regression back to a per-book or server zone.
    await db.update(ledgers).set({ timeZone: "Pacific/Kiritimati" });
    const zonedBookId = crypto.randomUUID();
    await db.insert(books).values({
      id: zonedBookId,
      name: "Zoned",
      sortOrder: 9,
    });
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        name: "Zoned Credential",
        tokenHash: computeHash(knownToken),
        bookId: zonedBookId,
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${knownToken}` },
      body: JSON.stringify({ images: [{ data: await validJpegBase64(), mimeType: "image/jpeg" }] }),
    });
    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    // The record went to the key's book, not to the ledger's default one.
    expect(doc?.bookId).toBe(zonedBookId);
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, doc!.latestAttemptId!),
    });
    expect(attempt?.requestedDate).toBe(getDateInTimezone("Pacific/Kiritimati"));
  });

  it("should delete service credential via Action", async () => {
    const db = getTestDb();
    // Create credential via action to get proper hash
    const createRes = await createCredential({
      name: "Delete Credential",
      bookId: await testBookId(getTestDb()),
    });

    // deleteServiceCredentialAction returns void
    await deleteServiceCredentialAction(createRes.id);

    const check = await db.query.serviceCredentials.findFirst({
      where: eq(serviceCredentials.id, createRes.id),
    });
    expect(check).toBeDefined();
    expect(check?.revokedAt).not.toBeNull();
  });

  it("tracks last use and rejects authentication immediately after revoke", async () => {
    const db = getTestDb();
    const credential = await createCredential({
      name: "Lifecycle Credential",
      bookId: await testBookId(getTestDb()),
    });
    const image = await validJpegBase64();
    const firstResponse = await ledgerEntryPOST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Idempotency-Key": "credential-lifecycle-record",
        },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    );
    const created = await firstResponse.json();
    expect(firstResponse.status).toBe(201);
    const usedCredential = await db.query.serviceCredentials.findFirst({
      where: eq(serviceCredentials.id, credential.id),
    });
    expect(usedCredential?.lastUsedAt).toBeInstanceOf(Date);

    await deleteServiceCredentialAction(credential.id);
    const revokedResponse = await ledgerEntryPOST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credential.token}` },
        body: JSON.stringify({ text: "Must be rejected" }),
      })
    );
    expect(revokedResponse.status).toBe(401);
    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, created.sourceDocumentId),
      })
    ).toBeDefined();
  });

  it("throttles lastUsedAt updates to once per five minutes", async () => {
    const db = getTestDb();
    const credential = await createCredential({
      name: "Throttle Credential",
      bookId: await testBookId(getTestDb()),
    });
    const image = await validJpegBase64();
    const post = () =>
      ledgerEntryPOST(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${credential.token}` },
          body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
        })
      );
    const readLastUsedAt = async () => {
      const row = await db.query.serviceCredentials.findFirst({
        where: eq(serviceCredentials.id, credential.id),
      });
      return row?.lastUsedAt ?? null;
    };

    // First authentication writes lastUsedAt.
    expect((await post()).status).toBe(201);
    const firstUsedAt = await readLastUsedAt();
    expect(firstUsedAt).toBeInstanceOf(Date);

    // A credential used two minutes ago is still fresh: repeated auth must not
    // write the column again.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: twoMinutesAgo })
      .where(eq(serviceCredentials.id, credential.id));
    expect((await post()).status).toBe(201);
    expect((await readLastUsedAt())?.getTime()).toBe(twoMinutesAgo.getTime());

    // Once the record is older than five minutes the next auth refreshes it.
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: sixMinutesAgo })
      .where(eq(serviceCredentials.id, credential.id));
    expect((await post()).status).toBe(201);
    expect((await readLastUsedAt())?.getTime()).toBeGreaterThan(sixMinutesAgo.getTime());
  });

  it("should return credentials with prefix/suffix via getLedgerSettingsView", async () => {
    // Create a credential via action to get proper hash-based credential
    const created = await createCredential({
      name: "New Credential",
      bookId: await testBookId(getTestDb()),
    });

    // Get settings via getLedgerSettingsView
    const settings = await getLedgerSettingsView();
    const settingsCredential = requireFirst(settings.credentials, "settings credential");

    expect(settings.credentials).toHaveLength(1);
    expect(settingsCredential.name).toBe("New Credential");
    // The credential should have prefix/suffix, not full key
    expect(settingsCredential.tokenPrefix).toBe(created.tokenPrefix);
    expect(settingsCredential.tokenSuffix).toBe(created.tokenSuffix);
    expect((settingsCredential as Record<string, unknown>).key).toBeUndefined();
  });
});
