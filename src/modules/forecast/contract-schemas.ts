import { z } from "zod";
import { UUID_REGEX } from "@/lib/validation";
import { periodInputSchema } from "@/modules/ledger/contract-schemas";

/** The forecast read: the same book and period 统计 itself reads. */
export const forecastInputSchema = z
  .object({
    bookId: z.string().regex(UUID_REGEX, "Invalid book").optional(),
    period: periodInputSchema,
  })
  .strict();
