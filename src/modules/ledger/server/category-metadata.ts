import "server-only";
import { z } from "zod";
import { COMMON_LUCIDE_ICONS } from "@/config/icons";
import { buildAiOutputLocaleInstruction } from "@/config/ai-output-locales";
import { generateStructured } from "@/lib/ai/structured";
import { NotFoundError } from "@/lib/errors";
import { buildLedgerInstructionSections } from "@/modules/ledger/domain/ledger-instructions";
import { getLedgerSettings } from "./settings";
import { getCategory, listCategories, updateMissingCategoryMetadata } from "./categories";

const metadataSchema = z.object({
  icon: z.enum(COMMON_LUCIDE_ICONS),
  description: z.string().trim().min(1).max(120),
});

export interface CategoryMetadataResult {
  categoryId: string;
  icon: string;
  description: string;
  status: "updated" | "already_complete" | "stale";
  wroteIcon: boolean;
  wroteDescription: boolean;
}

export async function generateCategoryMetadata(input: {
  categoryName: string;
  existingCategoryNames: readonly string[];
  language?: string;
  customPrompt?: string;
  learnedPreferences?: string;
}): Promise<{ icon: string; description: string }> {
  const prompt = `Generate bookkeeping category metadata. Return JSON only. The icon must be selected from the provided Lucide icon names. Keep the description short and concrete.
${buildLedgerInstructionSections({ customPrompt: input.customPrompt, learnedPreferences: input.learnedPreferences })}
${buildAiOutputLocaleInstruction(input.language)}
Only the category description is user-visible in this response; apply the mandatory output locale to it.`;
  return generateStructured({
    task: "category-metadata",
    schema: metadataSchema,
    system: prompt,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          category: input.categoryName,
          existingCategories: input.existingCategoryNames,
          language: input.language,
          allowedIcons: COMMON_LUCIDE_ICONS,
          output: { icon: "Lucide icon name", description: "maximum 120 characters" },
        }),
      },
    ],
    maxTokens: 180,
    temperature: 0.2,
  });
}

/**
 * Fills in the icon and description a category is missing. The write only lands
 * while the category still has the name the model was asked about, so a rename
 * racing the AI call reports `stale` instead of attaching the wrong text.
 */
export async function generateEntryCategoryMetadata(input: {
  categoryId: string;
}): Promise<CategoryMetadataResult> {
  const category = await getCategory(input.categoryId);
  if (category == null) throw new NotFoundError("Category");
  const categoryComplete =
    category.icon != null &&
    category.icon !== "" &&
    category.description != null &&
    category.description !== "";
  if (categoryComplete) {
    return {
      categoryId: input.categoryId,
      icon: category.icon!,
      description: category.description!,
      status: "already_complete",
      wroteIcon: false,
      wroteDescription: false,
    };
  }
  const [settings, existingCategories] = await Promise.all([getLedgerSettings(), listCategories()]);
  if (settings == null) throw new NotFoundError("Ledger");

  const metadata = await generateCategoryMetadata({
    categoryName: category.name,
    existingCategoryNames: existingCategories.map((existing) => existing.name),
    language: settings.aiLanguage,
    customPrompt: settings.aiCustomPrompt,
    learnedPreferences: settings.aiLearnedPreferences,
  });
  const written = await updateMissingCategoryMetadata(input.categoryId, {
    ...metadata,
    expectedName: category.name,
  });
  if (written.status === "not_found") throw new NotFoundError("Category");

  return {
    categoryId: input.categoryId,
    icon: metadata.icon,
    description: metadata.description,
    status: written.status,
    wroteIcon: written.wroteIcon,
    wroteDescription: written.wroteDescription,
  };
}
