"use server";
import { withLedgerAction } from "../action-access";
import type {
  CreateServiceCredentialErrorCode,
  CreateServiceCredentialResult,
  ServiceCredentialDto,
} from "@/modules/ledger/contracts";
import {
  parseCreateServiceCredentialInput,
  parseServiceCredentialId,
  parseUpdateServiceCredentialInput,
  type CreateServiceCredentialInput,
  type UpdateServiceCredentialInput,
} from "@/modules/ledger/contract-schemas";
import {
  createServiceCredential,
  revokeServiceCredential,
  setServiceCredentialBook,
} from "../server/service-credentials";
import { AppError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";

function toCreateServiceCredentialErrorCode(error: unknown): CreateServiceCredentialErrorCode {
  if (!(error instanceof AppError)) return "unexpected";
  switch (error.code) {
    case "BOOK_UNAVAILABLE":
      return "book_unavailable";
    case "CONFLICT":
      return "limit_reached";
    case "VALIDATION_ERROR":
      return "invalid";
    default:
      return "unexpected";
  }
}

/**
 * The refusals come back as codes: a production browser only sees a generic
 * message for a thrown action error, and 设置 has to say which one it was.
 */
export const createServiceCredentialAction = withLedgerAction(
  async (data: CreateServiceCredentialInput): Promise<CreateServiceCredentialResult> => {
    try {
      const credential = await createServiceCredential(parseCreateServiceCredentialInput(data));
      return { ok: true, credential };
    } catch (error) {
      const code = toCreateServiceCredentialErrorCode(error);
      if (code === "unexpected") logError("credentials:create", error);
      return { ok: false, code };
    }
  }
);

/** Rebinds one key to another book; its store of uploads follows immediately. */
export const updateServiceCredentialAction = withLedgerAction(
  async (
    credentialId: string,
    data: UpdateServiceCredentialInput
  ): Promise<ServiceCredentialDto> => {
    const validatedCredentialId = parseServiceCredentialId(credentialId);
    const validated = parseUpdateServiceCredentialInput(data);
    return setServiceCredentialBook(validatedCredentialId, validated.bookId);
  }
);

export const deleteServiceCredentialAction = withLedgerAction(
  async (credentialId: string): Promise<void> =>
    revokeServiceCredential(parseServiceCredentialId(credentialId))
);
