"use server";
import { withLedgerAction } from "@/modules/ledger/action-access";
import { clearLearnedPreferences } from "../server/learned-preferences";

export const clearLearnedPreferencesAction = withLedgerAction(clearLearnedPreferences);
