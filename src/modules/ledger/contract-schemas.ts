import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
  dateStringSchema,
  omitUndefinedObjectFields,
  optionalDateStringSchema,
  UUID_REGEX,
} from "@/lib/validation";
import { MAX_BATCH_SIZE } from "@/lib/batch-ids";
import { CATEGORY_ASSIGNMENT_MAX_ENTRIES } from "@/config/tuning";
import { isValidTimeZone } from "@/lib/date-utils";
import { MAX_SEARCH_LENGTH, normalizeSearchTerm } from "@/lib/search";
import { compare, DECIMAL_STRING_PATTERN, normalize } from "@/lib/money/decimal";
import {
  CALENDAR_RANGES,
  MAX_PERIOD_OFFSET,
  MIN_PERIOD_OFFSET,
} from "@/modules/ledger/domain/period";

const uuidSchema = z.string().regex(UUID_REGEX, "Invalid UUID");
const strictObjectSchema = <TShape extends z.ZodRawShape>(shape: TShape) =>
  z.preprocess(omitUndefinedObjectFields, z.object(shape).strict());
const nonEmptyStrictObjectSchema = <TShape extends z.ZodRawShape>(shape: TShape) =>
  z.preprocess(
    omitUndefinedObjectFields,
    z
      .object(shape)
      .strict()
      .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  );
const currencyCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code")
);
export const optionalCurrencyCodeSchema = currencyCodeSchema.optional();
const nullableCurrencyCodeSchema = currencyCodeSchema.nullable().optional();
const aiLanguageSchema = z.string().min(2).max(35);
const positiveDecimalSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
  .transform(normalize)
  .refine((value) => compare(value, "0") > 0, "Amount must be positive");
const nonZeroDecimalSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
  .transform(normalize)
  .refine((value) => compare(value, "0") !== 0, "Amount must be non-zero");
const optionalQueryDecimalSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
    .transform(normalize)
    .optional()
);
const optionalSearchSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeSearchTerm(value) : value),
  z.string().max(MAX_SEARCH_LENGTH).optional()
);
export const UNCATEGORIZED_SENTINEL = "__uncategorized__";
/** An IANA zone name this runtime can format with. */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(50)
  .refine(isValidTimeZone, "Invalid IANA time zone");
/** A period as the browser sends it; the server reads it in the ledger's zone. */
export const periodInputSchema = z.discriminatedUnion("range", [
  z
    .object({ range: z.enum(CALENDAR_RANGES), offset: z.number().int() })
    .strict()
    .refine(
      (value) =>
        value.offset >= MIN_PERIOD_OFFSET[value.range] &&
        value.offset <= MAX_PERIOD_OFFSET[value.range],
      { message: "Period out of reach", path: ["offset"] }
    ),
  z.object({ range: z.literal("all") }).strict(),
  z
    .object({ range: z.literal("custom"), from: dateStringSchema, to: dateStringSchema })
    .strict()
    .refine((value) => value.from <= value.to, { message: "Invalid date range", path: ["to"] }),
]);

export const categoryFilterSchema = z
  .union([uuidSchema, z.literal(UNCATEGORIZED_SENTINEL)])
  .optional();

function parseLedgerContract<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}

const updateLedgerInputSchema = nonEmptyStrictObjectSchema({
  settings: nonEmptyStrictObjectSchema({
    aiLanguage: aiLanguageSchema.optional(),
    currencies: z.array(currencyCodeSchema).max(32).optional(),
    mainCurrency: optionalCurrencyCodeSchema,
    collapseEntriesDefault: z.boolean().optional(),
    aiCustomPrompt: z.string().max(4000).optional(),
    aiLearnedPreferences: z.string().max(2000).optional(),
    aiPreferenceLearningEnabled: z.boolean().optional(),
    timeZone: timeZoneSchema.optional(),
  }),
});

const categoryCollectionRevisionSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Invalid category collection revision");
const saveEntryCategoriesInputSchema = strictObjectSchema({
  expectedRevision: categoryCollectionRevisionSchema,
  categories: z
    .array(
      strictObjectSchema({
        id: uuidSchema.optional(),
        clientId: uuidSchema.optional(),
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500).nullable(),
        icon: z.string().max(100).nullable(),
      }).superRefine((category, context) => {
        if ((category.id == null) === (category.clientId == null)) {
          context.addIssue({
            code: "custom",
            message: "Exactly one of id or clientId is required",
          });
        }
      })
    )
    .max(MAX_BATCH_SIZE)
    .superRefine((categories, context) => {
      const ids = categories.map((category) => category.id ?? category.clientId!);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: "custom", message: "Category IDs must be unique" });
      }
    }),
});
const ledgerEntryIdSchema = uuidSchema;
const ledgerEntryIdsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? [...new Set(value)] : value),
  z.array(uuidSchema).min(1).max(MAX_BATCH_SIZE)
);
// Fewer than two candidates leaves nothing for a model to choose between.
const candidateCategoryIdsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? [...new Set(value)] : value),
  z.array(uuidSchema).min(2)
);
const categoryAssignmentModeSchema = z.union([
  strictObjectSchema({ kind: z.literal("ai"), candidateCategoryIds: candidateCategoryIdsSchema }),
  strictObjectSchema({ kind: z.literal("assign"), categoryId: uuidSchema }),
  strictObjectSchema({ kind: z.literal("clear") }),
]);
const startCategoryAssignmentInputSchema = strictObjectSchema({
  requestKey: uuidSchema,
  mode: categoryAssignmentModeSchema,
  ledgerEntryIds: z.array(uuidSchema).min(1).max(CATEGORY_ASSIGNMENT_MAX_ENTRIES),
});
const retryCategoryAssignmentInputSchema = strictObjectSchema({
  jobId: uuidSchema,
  requestKey: uuidSchema,
});
const cancelCategoryAssignmentInputSchema = strictObjectSchema({ jobId: uuidSchema });
const entryCategoryIdSchema = uuidSchema;
const serviceCredentialIdSchema = uuidSchema;

const createLedgerEntryInputSchema = strictObjectSchema({
  amount: positiveDecimalSchema,
  currency: optionalCurrencyCodeSchema,
  itemName: z.string().trim().min(1).max(200),
  categoryId: uuidSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  sourceDocumentId: uuidSchema,
});

const batchUpdateLedgerEntriesInputSchema = nonEmptyStrictObjectSchema({
  categoryId: uuidSchema.nullable().optional(),
  currency: nullableCurrencyCodeSchema,
  amount: nonZeroDecimalSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  itemName: z.string().trim().min(1).max(200).optional(),
});

const batchUpdateLedgerEntryDatesInputSchema = strictObjectSchema({
  entryIds: ledgerEntryIdsSchema,
  entryDate: dateStringSchema,
});

const createServiceCredentialInputSchema = strictObjectSchema({
  name: z.string().trim().min(1).max(100),
  bookId: uuidSchema,
});

const updateServiceCredentialInputSchema = strictObjectSchema({
  bookId: uuidSchema,
});

/** Book names are short labels, not descriptions: 1–20 characters, trimmed. */
const bookNameSchema = z.string().trim().min(1).max(20);
const createBookInputSchema = strictObjectSchema({ name: bookNameSchema });
const updateBookInputSchema = strictObjectSchema({ name: bookNameSchema });
const reorderBooksInputSchema = z.preprocess(
  (value) => (Array.isArray(value) ? [...new Set(value)] : value),
  z.array(uuidSchema).min(1).max(100)
);
const bookIdSchema = uuidSchema;
const assignSourceDocumentBookInputSchema = strictObjectSchema({
  sourceDocumentId: uuidSchema,
  bookId: uuidSchema,
});

const ledgerEntryQueryShape = {
  bookId: uuidSchema.optional(),
  startDate: optionalDateStringSchema,
  endDate: optionalDateStringSchema,
  categoryId: categoryFilterSchema,
  currency: optionalCurrencyCodeSchema,
  minAmount: optionalQueryDecimalSchema,
  maxAmount: optionalQueryDecimalSchema,
  search: optionalSearchSchema,
};

function validateLedgerEntryQueryRange(
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    minAmount?: string | undefined;
    maxAmount?: string | undefined;
  },
  context: z.RefinementCtx
) {
  if (value.startDate != null && value.endDate != null && value.startDate > value.endDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "End date precedes start date",
    });
  }
  if (
    value.minAmount != null &&
    value.maxAmount != null &&
    compare(value.minAmount, value.maxAmount) > 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxAmount"],
      message: "Maximum amount is less than minimum amount",
    });
  }
}

export const listLedgerEntriesInputSchema = strictObjectSchema({
  ...ledgerEntryQueryShape,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine(validateLedgerEntryQueryRange);

export const ledgerStatsQuerySchema = strictObjectSchema({
  ...ledgerEntryQueryShape,
  categoryId: categoryFilterSchema,
}).superRefine(validateLedgerEntryQueryRange);

export const parseUpdateLedgerInput = (input: unknown) =>
  parseLedgerContract(updateLedgerInputSchema, input);
export const parseSaveEntryCategoriesInput = (input: unknown) =>
  parseLedgerContract(saveEntryCategoriesInputSchema, input);
export const parseEntryCategoryId = (input: unknown) =>
  parseLedgerContract(entryCategoryIdSchema, input);
export const parseCreateLedgerEntryInput = (input: unknown) =>
  parseLedgerContract(createLedgerEntryInputSchema, input);
export const parseBatchUpdateLedgerEntriesInput = (input: unknown) =>
  parseLedgerContract(batchUpdateLedgerEntriesInputSchema, input);
export const parseBatchUpdateLedgerEntryDatesInput = (input: unknown) =>
  parseLedgerContract(batchUpdateLedgerEntryDatesInputSchema, input);
export const parseLedgerEntryId = (input: unknown) =>
  parseLedgerContract(ledgerEntryIdSchema, input);
export const parseLedgerEntryIds = (input: unknown) =>
  parseLedgerContract(ledgerEntryIdsSchema, input);
export const parseStartCategoryAssignmentInput = (input: unknown) =>
  parseLedgerContract(startCategoryAssignmentInputSchema, input);
export const parseRetryCategoryAssignmentInput = (input: unknown) =>
  parseLedgerContract(retryCategoryAssignmentInputSchema, input);
export const parseCancelCategoryAssignmentInput = (input: unknown) =>
  parseLedgerContract(cancelCategoryAssignmentInputSchema, input);
export const parseCreateServiceCredentialInput = (input: unknown) =>
  parseLedgerContract(createServiceCredentialInputSchema, input);
export const parseUpdateServiceCredentialInput = (input: unknown) =>
  parseLedgerContract(updateServiceCredentialInputSchema, input);
export const parseCreateBookInput = (input: unknown) =>
  parseLedgerContract(createBookInputSchema, input);
export const parseUpdateBookInput = (input: unknown) =>
  parseLedgerContract(updateBookInputSchema, input);
export const parseReorderBooksInput = (input: unknown) =>
  parseLedgerContract(reorderBooksInputSchema, input);
export const parseBookId = (input: unknown) => parseLedgerContract(bookIdSchema, input);
export const parseAssignSourceDocumentBookInput = (input: unknown) =>
  parseLedgerContract(assignSourceDocumentBookInputSchema, input);
export const parseServiceCredentialId = (input: unknown) =>
  parseLedgerContract(serviceCredentialIdSchema, input);
export const parseListLedgerEntriesInput = (input: unknown) =>
  parseLedgerContract(listLedgerEntriesInputSchema, input);
export const parseLedgerStatsQuery = (input: unknown) =>
  parseLedgerContract(ledgerStatsQuerySchema, input);

export type UpdateLedgerInput = z.infer<typeof updateLedgerInputSchema>;
export type SaveEntryCategoriesInput = z.infer<typeof saveEntryCategoriesInputSchema>;
export type CreateLedgerEntryInput = z.infer<typeof createLedgerEntryInputSchema>;
export type BatchUpdateLedgerEntriesInput = z.infer<typeof batchUpdateLedgerEntriesInputSchema>;
export type CreateServiceCredentialInput = z.infer<typeof createServiceCredentialInputSchema>;
export type UpdateServiceCredentialInput = z.infer<typeof updateServiceCredentialInputSchema>;
export type CreateBookInput = z.infer<typeof createBookInputSchema>;
export type UpdateBookInput = z.infer<typeof updateBookInputSchema>;
export type ListLedgerEntriesInput = z.input<typeof listLedgerEntriesInputSchema>;
export type LedgerStatsQueryInput = z.infer<typeof ledgerStatsQuerySchema>;
