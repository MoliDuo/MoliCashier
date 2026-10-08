"use server";

import { applyDateOrganization, dismissDateOrganization } from "../server/date-organization";
import {
  applyDateOrganizationInputSchema,
  dismissDateOrganizationInputSchema,
} from "@/modules/source-document/contract-schemas";
import { withLedgerAction } from "@/modules/ledger/action-access";

export const applyDateOrganizationAction = withLedgerAction(async (input: unknown) => {
  const validated = applyDateOrganizationInputSchema.parse(input);
  return applyDateOrganization(validated);
});

export const dismissDateOrganizationAction = withLedgerAction(async (input: unknown) => {
  const validated = dismissDateOrganizationInputSchema.parse(input);
  return dismissDateOrganization(validated);
});
