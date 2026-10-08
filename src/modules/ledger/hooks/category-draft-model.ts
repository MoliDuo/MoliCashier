import type { EntryCategoryDto } from "@/modules/ledger/contracts";

export interface CategoryDraft {
  key: string;
  id?: string;
  clientId?: string;
  name: string;
  description: string;
  icon: string | null;
  entryCount?: number;
}

interface EditDraft {
  key: string;
  name: string;
  description: string;
  icon: string | null;
}

export interface EditSession {
  original: EditDraft;
  draft: EditDraft;
}

export function toCategoryDraft(category: EntryCategoryDto): CategoryDraft {
  return {
    key: category.id,
    id: category.id,
    name: category.name,
    description: category.description ?? "",
    icon: category.icon,
    ...("entryCount" in category && typeof category.entryCount === "number"
      ? { entryCount: category.entryCount }
      : {}),
  };
}

export function categoryDraftsEqual(left: CategoryDraft[], right: CategoryDraft[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((category, index) => {
    const other = right[index];
    return (
      other != null &&
      category.key === other.key &&
      category.name === other.name &&
      category.description === other.description &&
      category.icon === other.icon
    );
  });
}

export function editDraftEqual(left: EditDraft, right: EditDraft): boolean {
  return (
    left.name === right.name && left.description === right.description && left.icon === right.icon
  );
}
