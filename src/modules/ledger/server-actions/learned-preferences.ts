"use server";
import { withLedgerAccess } from "@/modules/ledger/access";
import { clearLearnedPreferences } from "../server/learned-preferences";

export const clearLearnedPreferencesAction = withLedgerAccess(clearLearnedPreferences);
