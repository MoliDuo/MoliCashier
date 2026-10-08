import "server-only";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ledgers, sourceDocuments } from "@/persistence";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { omitUndefinedProperties } from "@/lib/validation";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import type { UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import type { LedgerDto, LedgerSettings } from "@/modules/ledger/contracts";

export function mapLedgerSettings(
  row: Pick<
    typeof ledgers.$inferSelect,
    | "aiLanguage"
    | "preferredCurrencies"
    | "mainCurrency"
    | "collapseEntriesDefault"
    | "aiCustomPrompt"
    | "aiLearnedPreferences"
    | "aiLearnedPreferencesUpdatedAt"
    | "aiPreferenceLearningEnabled"
    | "timeZone"
  >
): LedgerSettings {
  return {
    aiLanguage: row.aiLanguage,
    currencies: row.preferredCurrencies,
    mainCurrency: row.mainCurrency,
    collapseEntriesDefault: row.collapseEntriesDefault,
    aiCustomPrompt: row.aiCustomPrompt,
    aiLearnedPreferences: row.aiLearnedPreferences,
    aiLearnedPreferencesUpdatedAt: row.aiLearnedPreferencesUpdatedAt?.toISOString() ?? null,
    aiPreferenceLearningEnabled: row.aiPreferenceLearningEnabled,
    timeZone: row.timeZone,
  };
}

function settingsColumns(settings: Partial<LedgerSettings>) {
  return {
    ...(settings.aiLanguage === undefined ? {} : { aiLanguage: settings.aiLanguage }),
    ...(settings.currencies === undefined ? {} : { preferredCurrencies: settings.currencies }),
    ...(settings.mainCurrency === undefined ? {} : { mainCurrency: settings.mainCurrency }),
    ...(settings.collapseEntriesDefault === undefined
      ? {}
      : { collapseEntriesDefault: settings.collapseEntriesDefault }),
    ...(settings.aiCustomPrompt === undefined ? {} : { aiCustomPrompt: settings.aiCustomPrompt }),
    ...(settings.aiLearnedPreferences === undefined
      ? {}
      : { aiLearnedPreferences: settings.aiLearnedPreferences }),
    ...(settings.aiPreferenceLearningEnabled === undefined
      ? {}
      : { aiPreferenceLearningEnabled: settings.aiPreferenceLearningEnabled }),
    ...(settings.timeZone === undefined ? {} : { timeZone: settings.timeZone }),
  };
}

export async function getLedgerSettings(): Promise<LedgerSettings | null> {
  const ledger = await db.query.ledgers.findFirst({
    columns: {
      aiLanguage: true,
      preferredCurrencies: true,
      mainCurrency: true,
      collapseEntriesDefault: true,
      aiCustomPrompt: true,
      aiLearnedPreferences: true,
      aiLearnedPreferencesUpdatedAt: true,
      aiPreferenceLearningEnabled: true,
      timeZone: true,
    },
  });
  return ledger == null ? null : mapLedgerSettings(ledger);
}

async function updateSettingsRow(
  changes: Partial<LedgerSettings>
): Promise<{ ledger: LedgerDto; mainCurrencyChanged: boolean } | null> {
  return db.transaction(async (tx) => {
    const ledger = await tx
      .select()
      .from(ledgers)
      .for("update")
      .then((rows) => rows[0]);
    if (ledger == null) return null;
    const stored = mapLedgerSettings(ledger);
    const settings = { ...stored, ...changes };
    const previousMainCurrency = ledger.mainCurrency;
    const nextMainCurrency = settings.mainCurrency.trim().toUpperCase();
    const nextCurrencies = settings.currencies.map((currency) => currency.trim().toUpperCase());
    // A currency the ledger already holds stays valid after it leaves the
    // supported list, so saving another setting never fails on it; only a
    // newly chosen one has to be supported.
    const allowed = new Set<string>([
      ...SUPPORTED_CURRENCIES,
      stored.mainCurrency,
      ...stored.currencies,
    ]);
    for (const currency of [nextMainCurrency, ...nextCurrencies]) {
      if (!allowed.has(currency)) {
        throw new AppError(`Currency not found: ${currency}`, "CURRENCY_NOT_FOUND", 400);
      }
    }
    if (
      (changes.mainCurrency !== undefined || changes.currencies !== undefined) &&
      !nextCurrencies.includes(nextMainCurrency)
    ) {
      throw new ValidationError("Main currency must be included in preferred currencies");
    }
    const updatedAt = new Date(Math.max(Date.now(), ledger.updatedAt.getTime() + 1));
    const updated = await tx
      .update(ledgers)
      .set({
        ...settingsColumns({
          ...settings,
          currencies: nextCurrencies,
          mainCurrency: nextMainCurrency,
        }),
        updatedAt,
      })
      .returning()
      .then((rows) => rows[0]);
    if (updated == null) throw new ConflictError("Failed to update ledger settings");
    return {
      ledger: {
        settings: mapLedgerSettings(updated),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      mainCurrencyChanged: previousMainCurrency !== nextMainCurrency,
    };
  });
}

/**
 * A ledger that only ever recorded its old main currency may have no rates
 * for its days; once the main currency changes every entry converts, so the
 * rates for all its document days are fetched. Best effort: a day still
 * missing reads as unconverted until maintenance fills it.
 */
async function ensureExchangeRatesForLedger(): Promise<void> {
  const rows = await db
    .selectDistinct({ documentDate: sourceDocuments.documentDate })
    .from(sourceDocuments);
  await ensureExchangeRates(rows.map((row) => row.documentDate));
}

export async function updateLedgerSettings(data: UpdateLedgerInput): Promise<LedgerDto> {
  const updated = await updateSettingsRow(omitUndefinedProperties(data.settings ?? {}));
  if (updated == null) throw new NotFoundError("Ledger");
  if (updated.mainCurrencyChanged) await ensureExchangeRatesForLedger();
  return updated.ledger;
}
