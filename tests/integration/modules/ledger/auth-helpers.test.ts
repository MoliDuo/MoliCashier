import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import { ledgers } from "@/persistence";
import { randomUUID } from "node:crypto";
import { ensureTestLedgerBooks } from "tests/helpers/schema-setup";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

function mockSession(email = "test@example.com") {
  vi.mocked(getCurrentSession).mockResolvedValue(testSession({ email }));
}

function mockNoSession() {
  vi.mocked(getCurrentSession).mockResolvedValue(null);
}

describe("requireLedgerAccess", () => {
  beforeEach(async () => {
    mockSession();
    const db = getTestDb();

    // Clean up any existing ledgers first (due to unique constraint)
    await db.delete(ledgers);

    await db.insert(ledgers).values({
      id: randomUUID(),
    });
    await ensureTestLedgerBooks(db);
  });

  it("returns the ledger when it exists", async () => {
    const result = await requireLedgerAccess();
    expect(result.ledger.settings).toMatchObject({ mainCurrency: "CNY" });
  });

  it("returns 404 error when no ledger exists yet", async () => {
    const db = getTestDb();
    await db.delete(ledgers);

    await expect(requireLedgerAccess()).rejects.toThrow(NotFoundError);
  });

  it("returns 401 error when not authenticated", async () => {
    mockNoSession();
    await expect(requireLedgerAccess()).rejects.toThrow(UnauthorizedError);
  });
});
