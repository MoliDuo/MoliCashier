import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  EntryCategoryDto,
  EntryCategoryWithCountDto,
  SaveEntryCategoriesInput,
} from "@/modules/ledger/contracts";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import {
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import {
  lockLedgerForUpdate,
  lockSourceDocumentsForUpdate,
  type PostgresTransaction,
} from "@/lib/db/transaction-locks";
import { assertSourceDocumentsNotProcessing } from "@/modules/source-document/server/write-guards";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

function mapCategory(row: typeof entryCategories.$inferSelect): EntryCategoryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertCategoryCandidatesMutable(
  tx: PostgresTransaction,
  categoryIds: readonly string[]
): Promise<void> {
  if (categoryIds.length === 0) return;
  const active = await tx
    .select({ id: categoryAssignmentJobs.id })
    .from(categoryAssignmentJobs)
    .where(
      and(
        inArray(categoryAssignmentJobs.status, ["pending", "running"]),
        sql`(
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${categoryAssignmentJobs.candidateSnapshot}) AS candidate
            WHERE ${inArray(sql`(candidate->>'id')::uuid`, categoryIds)}
          )
          OR ${inArray(categoryAssignmentJobs.assignCategoryId, categoryIds)}
        )`
      )
    )
    .limit(1)
    .then((rows) => rows[0]);
  if (active != null) {
    throw new AppError(
      "A category assignment is using these categories",
      "CATEGORY_ASSIGNMENT_ACTIVE",
      409
    );
  }
}

export async function listCategories(): Promise<EntryCategoryDto[]> {
  const rows = await db
    .select()
    .from(entryCategories)
    .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
  return rows.map(mapCategory);
}

export async function getCategory(categoryId: string): Promise<EntryCategoryDto | null> {
  const row = await db.query.entryCategories.findFirst({
    where: eq(entryCategories.id, categoryId),
  });
  return row == null ? null : mapCategory(row);
}

export async function listCategoriesWithCount(): Promise<EntryCategoryWithCountDto[]> {
  const rows = await db
    .select({
      category: entryCategories,
      entryCount: sql<number>`count(${sourceDocuments.id})`,
    })
    .from(entryCategories)
    .leftJoin(ledgerEntries, eq(ledgerEntries.categoryId, entryCategories.id))
    .leftJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .groupBy(entryCategories.id)
    .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
  return rows.map(({ category, entryCount }) => ({
    ...mapCategory(category),
    entryCount: Number(entryCount),
  }));
}

export async function updateMissingCategoryMetadata(
  categoryId: string,
  input: { icon: string; description: string; expectedName: string }
): Promise<{
  status: "updated" | "stale" | "not_found";
  wroteIcon: boolean;
  wroteDescription: boolean;
}> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const category = await tx
      .select({
        name: entryCategories.name,
        icon: entryCategories.icon,
        description: entryCategories.description,
      })
      .from(entryCategories)
      .where(eq(entryCategories.id, categoryId))
      .for("update")
      .then((rows) => rows[0]);
    if (category == null) {
      return { status: "not_found" as const, wroteIcon: false, wroteDescription: false };
    }
    if (category.name !== input.expectedName) {
      return { status: "stale" as const, wroteIcon: false, wroteDescription: false };
    }
    const wroteIcon = category.icon == null || category.icon === "";
    const wroteDescription = category.description == null || category.description === "";
    if (!wroteIcon && !wroteDescription) {
      return { status: "updated" as const, wroteIcon: false, wroteDescription: false };
    }
    if (wroteDescription) await assertCategoryCandidatesMutable(tx, [categoryId]);
    await tx
      .update(entryCategories)
      .set({
        ...(wroteIcon ? { icon: input.icon } : {}),
        ...(wroteDescription ? { description: input.description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(entryCategories.id, categoryId));
    return { status: "updated" as const, wroteIcon, wroteDescription };
  });
}

export async function saveEntryCategories(
  input: SaveEntryCategoriesInput
): Promise<EntryCategoryDto[]> {
  const { expectedRevision } = input;
  const targets = input.categories.map((category, sortOrder) => ({ ...category, sortOrder }));
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const current = await tx
      .select()
      .from(entryCategories)
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id)
      .for("update");
    const actualRevision = await computeCategoryCollectionRevision(current);
    if (actualRevision !== expectedRevision) {
      throw new ConflictError("Category collection changed since it was loaded");
    }
    const currentById = new Map(current.map((category) => [category.id, category]));
    const targetIds = new Set(targets.map((target) => target.id ?? target.clientId!));

    for (const target of targets) {
      const resolvedId = target.id ?? target.clientId!;
      const existing = currentById.get(resolvedId);
      if (target.id != null && existing == null) {
        throw new ValidationError("Category target contains an inaccessible category");
      }
    }

    const removed = current.filter((category) => !targetIds.has(category.id));
    const candidateAffectingIds = [
      ...removed.map((category) => category.id),
      ...targets.flatMap((target) => {
        const existing = target.id == null ? undefined : currentById.get(target.id);
        return existing != null &&
          (existing.name !== target.name || existing.description !== target.description)
          ? [existing.id]
          : [];
      }),
    ];
    await assertCategoryCandidatesMutable(tx, candidateAffectingIds);

    const now = new Date();
    const removedIds = removed.map((category) => category.id);
    if (removedIds.length > 0) {
      const affectedDocumentIds = await tx
        .selectDistinct({ id: sourceDocuments.id })
        .from(ledgerEntries)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
        .where(inArray(ledgerEntries.categoryId, removedIds))
        .then((rows) => rows.map((row) => row.id).sort());
      const documents = await lockSourceDocumentsForUpdate(tx, affectedDocumentIds);
      await assertSourceDocumentsNotProcessing(tx, documents);
      await tx
        .update(ledgerEntries)
        .set({ categoryId: null, updatedAt: now })
        .where(inArray(ledgerEntries.categoryId, removedIds));
      await tx.delete(entryCategories).where(inArray(entryCategories.id, removedIds));
    }

    const existingTargets = targets.filter((target) =>
      currentById.has(target.id ?? target.clientId!)
    );
    // One statement renames them all. Names are unique through a deferrable
    // constraint, checked when the statement ends rather than row by row, so a
    // save may swap or rotate names among its categories.
    if (existingTargets.length > 0) {
      const updates = JSON.stringify(
        existingTargets.map((target) => ({
          id: target.id ?? target.clientId!,
          name: target.name,
          description: target.description,
          icon: target.icon,
          sort_order: target.sortOrder,
        }))
      );
      const updated = await tx.execute(sql`
        WITH changes AS (
          SELECT * FROM jsonb_to_recordset(${updates}::jsonb) AS value(
            id uuid,
            name text,
            description text,
            icon text,
            sort_order integer
          )
        )
        UPDATE entry_categories AS category
        SET name = changes.name,
            description = changes.description,
            icon = changes.icon,
            sort_order = changes.sort_order,
            updated_at = ${now}
        FROM changes
        WHERE category.id = changes.id
        RETURNING category.id
      `);
      if (updated.rows.length !== existingTargets.length) {
        throw new ConflictError("Category collection changed during update");
      }
    }

    const newTargets = targets.filter((target) => !currentById.has(target.id ?? target.clientId!));
    if (newTargets.length > 0) {
      await tx.insert(entryCategories).values(
        newTargets.map((target) => ({
          id: target.id ?? target.clientId!,
          name: target.name,
          description: target.description,
          icon: target.icon,
          sortOrder: target.sortOrder,
          updatedAt: now,
        }))
      );
    }

    const savedIds = targets.map((target) => target.id ?? target.clientId!);
    if (savedIds.length === 0) return [];
    const saved = await tx
      .select()
      .from(entryCategories)
      .where(inArray(entryCategories.id, savedIds))
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
    if (saved.length !== savedIds.length) {
      throw new ConflictError("Category save changed during update");
    }
    return saved.map(mapCategory);
  });
}

export async function countUncategorizedEntries(): Promise<number> {
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .where(isNull(ledgerEntries.categoryId))
    .then((rows) => rows[0]);
  return Number(row?.count ?? 0);
}
