"use server";
import { withLedgerAction } from "../action-access";
import type {
  SaveEntryCategoriesErrorCode,
  SaveEntryCategoriesResult,
} from "@/modules/ledger/contracts";
import {
  parseSaveEntryCategoriesInput,
  type SaveEntryCategoriesInput,
} from "@/modules/ledger/contract-schemas";
import { saveEntryCategories } from "../server/categories";
import { AppError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";

/**
 * A thrown action error reaches a production browser as a generic message, so
 * the refusals 设置 has to explain come back as codes.
 */
function toSaveEntryCategoriesErrorCode(error: unknown): SaveEntryCategoriesErrorCode {
  if (!(error instanceof AppError)) return "unexpected";
  switch (error.code) {
    case "CONFLICT":
      return "conflict";
    case "CATEGORY_ASSIGNMENT_ACTIVE":
      return "assignment_active";
    case "VALIDATION_ERROR":
      return "invalid";
    default:
      return "unexpected";
  }
}

export const saveEntryCategoriesAction = withLedgerAction(
  async (input: SaveEntryCategoriesInput): Promise<SaveEntryCategoriesResult> => {
    try {
      const validated = parseSaveEntryCategoriesInput(input);
      const categories = await saveEntryCategories({
        expectedRevision: validated.expectedRevision,
        categories: validated.categories.map((category) => ({
          ...(category.id === undefined ? {} : { id: category.id }),
          ...(category.clientId === undefined ? {} : { clientId: category.clientId }),
          name: category.name,
          description: category.description,
          icon: category.icon,
        })),
      });
      return { ok: true, categories };
    } catch (error) {
      const code = toSaveEntryCategoriesErrorCode(error);
      if (code === "unexpected") logError("categories:save", error);
      return { ok: false, code };
    }
  }
);
