"use server";

import { parseEntryCategoryId } from "../contract-schemas";
import { withLedgerAction } from "../action-access";
import { generateEntryCategoryMetadata } from "../server/category-metadata";

export const generateEntryCategoryMetadataAction = withLedgerAction(
  async (inputCategoryId: string) =>
    generateEntryCategoryMetadata({ categoryId: parseEntryCategoryId(inputCategoryId) })
);
