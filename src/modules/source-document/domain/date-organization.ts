import type {
  DateHint,
  DateOrganizationSuggestion,
  DateOrganizationSuggestionItem,
} from "@/lib/source-document/suggestions";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY = /^(\d{1,2})-(\d{1,2})$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function resolveDateHint(hint: DateHint, referenceDate: string | null): string | null {
  if (hint == null) return null;
  if (hint.kind === "absolute") return validDate(hint.value) ? hint.value : null;
  if (referenceDate == null || !validDate(referenceDate)) return null;
  if (hint.kind === "relative") {
    const offsets: Record<string, number> = { today: 0, yesterday: -1, day_before_yesterday: -2 };
    const offset = offsets[hint.value];
    if (offset == null) return null;
    const date = new Date(`${referenceDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  const match = MONTH_DAY.exec(hint.value);
  if (match == null) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(referenceDate.slice(0, 4));
  let result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!validDate(result)) return null;
  if (result > referenceDate) {
    year -= 1;
    result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return validDate(result) ? result : null;
}

export function createDateOrganizationSuggestion(input: {
  referenceDate: string | null;
  sourceDocumentDate: string;
  entries: Array<{
    id: string;
    itemName: string;
    amount: string;
    currency: string;
    dateHint?: DateHint;
  }>;
}): DateOrganizationSuggestion | null {
  const items: DateOrganizationSuggestionItem[] = input.entries.flatMap((entry) => {
    if (entry.dateHint == null) return [];
    const resolvedDate = resolveDateHint(entry.dateHint, input.referenceDate);
    if (resolvedDate == null) return [];
    return [
      {
        ledgerEntryId: entry.id,
        dateHint: entry.dateHint,
        resolvedDate,
        sourceText: entry.dateHint.sourceText,
        snapshot: { itemName: entry.itemName, amount: entry.amount, currency: entry.currency },
      },
    ];
  });
  if (items.length === 0 || items.every((item) => item.resolvedDate === input.sourceDocumentDate)) {
    return null;
  }
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    referenceDate: input.referenceDate,
    sourceDocumentDate: input.sourceDocumentDate,
    items,
  };
}
