import { z } from "zod";
import { createHash } from "crypto";
import { SOURCE_DOCUMENT_PROCESSING_STATUSES } from "@/modules/source-document/types";
import { ValidationError } from "@/lib/errors";
import {
  dateStringSchema,
  omitUndefinedObjectFields,
  optionalDateStringSchema,
  UUID_REGEX,
} from "@/lib/validation";
import { MAX_BATCH_SIZE } from "@/lib/batch-ids";
import { MAX_SEARCH_LENGTH, normalizeSearchTerm } from "@/lib/search";
import { MAX_FILES, MAX_TEXT_CHARACTERS, SUPPORTED_MIME_TYPES } from "@/lib/storage/upload-policy";
import {
  API_V1_MAX_DECODED_BATCH_BYTES,
  API_V1_MAX_DECODED_IMAGE_BYTES,
  API_V1_MAX_IMAGES,
  type PreparedInlineImage,
} from "@/modules/source-document/api-v1-policy";
import { decodeBase64Image } from "@/modules/source-document/base64-image";
import {
  categoryFilterSchema,
  optionalCurrencyCodeSchema,
} from "@/modules/ledger/contract-schemas";
import { compare, DECIMAL_STRING_PATTERN, normalize } from "@/lib/money/decimal";

const uuidSchema = z.string().regex(UUID_REGEX, "Invalid UUID");
const strictObjectSchema = <TShape extends z.ZodRawShape>(shape: TShape) =>
  z.preprocess(omitUndefinedObjectFields, z.object(shape).strict());
const optionalQueryDecimalSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
    .transform(normalize)
    .optional()
);
const sourceDocumentStatusSchema = z.enum(SOURCE_DOCUMENT_PROCESSING_STATUSES);
const optionalSearchSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeSearchTerm(value) : value),
  z.string().max(MAX_SEARCH_LENGTH).optional()
);
const codePointLimitedText = (max: number) =>
  z.string().refine((value) => [...value].length <= max, `Must contain at most ${max} characters`);
const optionalTitleSchema = codePointLimitedText(200)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "Title must not be empty")
  .optional();

// Build MIME pattern from the shared policy list
const SUPPORTED_MIME_PATTERN = SUPPORTED_MIME_TYPES.map((t) =>
  t.replace("image/", "").replace(/[.+*?^${}()|[\]\\]/g, "\\$&")
).join("|");
const IMAGE_MIME_REGEX = new RegExp(`^image/(${SUPPORTED_MIME_PATTERN})$`);

export const sourceDocumentIdSchema = uuidSchema;
export const clientSubmissionIdSchema = uuidSchema;

/**
 * Idempotency-Key header contract for POST /api/v1/source-documents.
 *
 * The value is validated but deliberately NOT trimmed or normalized: the raw
 * header bytes are the key identity, so a legal value is passed through
 * unchanged and an all-whitespace value is rejected.
 */
export const apiV1IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim() !== "", {
    message: "Idempotency key must contain between 1 and 512 characters",
  });

export const sourceDocumentIdsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? [...new Set(value)] : value),
  z.array(uuidSchema).min(1).max(MAX_BATCH_SIZE)
);

/** The documents a batch command touches, in the order they are locked. */
const sourceDocumentTargetIdsSchema = sourceDocumentIdsSchema.transform((ids) =>
  [...ids].sort((left, right) => left.localeCompare(right))
);

const sourceDocumentPayloadSchema = strictObjectSchema({
  bookId: uuidSchema.optional(),
  text: z
    .string()
    .max(MAX_TEXT_CHARACTERS, `Text too long (max ${MAX_TEXT_CHARACTERS} characters)`)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "Text must not be empty")
    .optional(),
  storedFileIds: z
    .array(uuidSchema)
    .max(MAX_FILES, `Maximum ${MAX_FILES} images allowed`)
    .optional(),
  documentDate: optionalDateStringSchema,
});

export const createSourceDocumentInputSchema = sourceDocumentPayloadSchema.superRefine(
  (value, ctx) => {
    if (
      (value.text == null || value.text === "") &&
      (value.storedFileIds == null || value.storedFileIds.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Content (text or images) is required",
      });
    }
  }
);

/** API v1 is the compact Shortcut contract: inline images plus an optional business date. */
const API_V1_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const apiV1EntryDateSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const match = API_V1_TIMESTAMP_PATTERN.exec(value);
  if (match == null) return value;
  const validTime = Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59;
  const validOffset = match[5] == null || (Number(match[6]) <= 23 && Number(match[7]) <= 59);
  if (!validTime || !validOffset || Number.isNaN(Date.parse(value))) return value;
  return match[1];
}, optionalDateStringSchema);

/**
 * API v1 image schema. Decodes each image exactly once, validates the MIME
 * type and per-image decoded size, and computes the content hash. The output
 * is the internal PreparedInlineImage contract: only bytes, MIME, and hash
 * are retained — never the full base64 representation.
 */
const apiV1PreparedImageSchema = strictObjectSchema({
  data: z.string().min(1, "Image data is required"),
  mimeType: z.string().regex(IMAGE_MIME_REGEX, "Invalid image type"),
}).transform((image, ctx) => {
  let decoded: ReturnType<typeof decodeBase64Image>;
  try {
    decoded = decodeBase64Image(image.data, image.mimeType);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      path: ["data"],
      message: error instanceof Error ? error.message : "Invalid base64 image data",
    });
    return z.NEVER;
  }
  if (decoded.bytes.length > API_V1_MAX_DECODED_IMAGE_BYTES) {
    ctx.addIssue({
      code: "custom",
      path: ["data"],
      message: `Image exceeds ${API_V1_MAX_DECODED_IMAGE_BYTES / 1024 / 1024}MB`,
    });
    return z.NEVER;
  }
  return {
    bytes: decoded.bytes,
    mimeType: image.mimeType.toLowerCase(),
    contentHash: createHash("sha256").update(decoded.bytes).digest("hex"),
  } satisfies PreparedInlineImage;
});

const imagesSchemaV1 = z
  .array(apiV1PreparedImageSchema)
  .min(1, "At least one image is required")
  .max(API_V1_MAX_IMAGES, `Maximum ${API_V1_MAX_IMAGES} images allowed`)
  .superRefine((images, ctx) => {
    // Failed elements keep their raw input shape, so only sum decoded sizes
    // for elements that actually reached the transform.
    const total = images.reduce((sum, image) => sum + (image.bytes?.length ?? 0), 0);
    if (total > API_V1_MAX_DECODED_BATCH_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `Decoded image batch exceeds ${API_V1_MAX_DECODED_BATCH_BYTES / 1024 / 1024} MiB`,
      });
    }
  });

const sourceDocumentPayloadSchemaV1 = strictObjectSchema({
  images: imagesSchemaV1,
  entryDate: apiV1EntryDateSchema,
});

export const createSourceDocumentInputSchemaV1 = sourceDocumentPayloadSchemaV1;

export const retrySourceDocumentInputSchema = strictObjectSchema({
  text: z.string().trim().max(MAX_TEXT_CHARACTERS).nullable(),
  storedFileIds: z.array(uuidSchema).max(MAX_FILES),
  documentDate: dateStringSchema.nullable(),
}).superRefine((value, ctx) => {
  if ((value.text == null || value.text === "") && value.storedFileIds.length === 0) {
    ctx.addIssue({ code: "custom", message: "Content (text or images) is required" });
  }
});

const validateFilterRange = (
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    minAmount?: string | undefined;
    maxAmount?: string | undefined;
  },
  context: z.RefinementCtx
) => {
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
};

const streamPageCursorSchema = z
  .string()
  .regex(/^v\d+\|/, "Invalid stream cursor format")
  .or(z.literal(""));
const streamFilterInputShape = {
  bookId: uuidSchema.optional(),
  startDate: optionalDateStringSchema,
  endDate: optionalDateStringSchema,
  minAmount: optionalQueryDecimalSchema,
  maxAmount: optionalQueryDecimalSchema,
  statuses: z
    .preprocess(
      (value) => (Array.isArray(value) ? [...new Set(value)] : value),
      z.array(sourceDocumentStatusSchema).max(7)
    )
    .optional(),
  search: optionalSearchSchema,
  categoryId: categoryFilterSchema,
  currency: optionalCurrencyCodeSchema,
};

export const streamTotalInputSchema =
  strictObjectSchema(streamFilterInputShape).superRefine(validateFilterRange);

export const streamPageInputSchema = strictObjectSchema({
  ...streamFilterInputShape,
  cursor: streamPageCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
}).superRefine(validateFilterRange);

export const updateSourceDocumentInputSchema = strictObjectSchema({
  title: optionalTitleSchema,
  documentDate: optionalDateStringSchema,
}).refine((value) => value.title !== undefined || value.documentDate !== undefined, {
  message: "At least one source document patch is required",
});

export const splitSourceDocumentInputSchema = strictObjectSchema({
  sourceDocumentId: uuidSchema,
  ledgerEntryIds: z
    .array(uuidSchema)
    .min(1)
    .max(MAX_BATCH_SIZE)
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "A ledger entry may only be split once" });
      }
    }),
  entryDate: dateStringSchema,
});

const dateOrganizationGroupSchema = strictObjectSchema({
  id: z.string().trim().min(1).max(80),
  entryDate: dateStringSchema.nullable(),
  ledgerEntryIds: z.array(uuidSchema).min(1).max(MAX_BATCH_SIZE),
});

export const applyDateOrganizationInputSchema = strictObjectSchema({
  sourceDocumentId: uuidSchema,
  suggestionId: uuidSchema,
  groups: z.array(dateOrganizationGroupSchema).min(1).max(MAX_BATCH_SIZE),
  appliedGroupIds: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_BATCH_SIZE),
}).superRefine((input, ctx) => {
  const allEntries = input.groups.flatMap((group) => group.ledgerEntryIds);
  if (new Set(allEntries).size !== allEntries.length) {
    ctx.addIssue({ code: "custom", message: "A ledger entry may only belong to one date group" });
  }
  const groupIds = new Set(input.groups.map((group) => group.id));
  const appliedGroupIds = new Set(input.appliedGroupIds);
  if (
    groupIds.size !== input.groups.length ||
    appliedGroupIds.size !== input.appliedGroupIds.length ||
    input.appliedGroupIds.some((id) => !groupIds.has(id))
  ) {
    ctx.addIssue({ code: "custom", message: "Date organization groups must be unique" });
  }
  const targetDates = input.groups.flatMap((group) =>
    group.entryDate == null ? [] : [group.entryDate]
  );
  if (new Set(targetDates).size !== targetDates.length) {
    ctx.addIssue({ code: "custom", message: "Date organization target dates must be unique" });
  }
  if (input.groups.some((group) => group.entryDate == null && appliedGroupIds.has(group.id))) {
    ctx.addIssue({ code: "custom", message: "Retained entries cannot be applied" });
  }
});

export const dismissDateOrganizationInputSchema = strictObjectSchema({
  sourceDocumentId: uuidSchema,
  suggestionId: uuidSchema,
});

export const applyDuplicateSuggestionInputSchema = strictObjectSchema({
  sourceDocumentId: uuidSchema,
  suggestionId: uuidSchema,
});

export const dismissDuplicateSuggestionInputSchema = applyDuplicateSuggestionInputSchema;

export const batchUpdateSourceDocumentsInputSchema = strictObjectSchema({
  sourceDocumentIds: sourceDocumentTargetIdsSchema,
  data: updateSourceDocumentInputSchema,
});

function parseSourceDocumentContract<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }

  return result.data;
}

export function parseSourceDocumentId(input: unknown): string {
  return parseSourceDocumentContract(sourceDocumentIdSchema, input);
}

export function parseSourceDocumentTargetIds(input: unknown): string[] {
  return parseSourceDocumentContract(sourceDocumentTargetIdsSchema, input);
}

export type CreateSourceDocumentInputContract = z.infer<typeof createSourceDocumentInputSchema>;
export type RetrySourceDocumentInputContract = z.infer<typeof retrySourceDocumentInputSchema>;
export type BatchUpdateSourceDocumentsInput = z.infer<typeof updateSourceDocumentInputSchema>;
