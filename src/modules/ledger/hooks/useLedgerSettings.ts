"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSmartPolling } from "@/hooks/use-smart-polling";
import { LEDGER } from "@/lib/constants";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import { omitUndefinedProperties } from "@/lib/validation";
import type { UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import type {
  CreatedServiceCredential,
  EntryCategory,
  EntryCategoryWithCount,
  Ledger,
  SaveEntryCategoriesInput,
  ServiceCredential,
  UpdateLedgerActionErrorCode,
} from "@/modules/ledger/contracts";
import { fetchEntryCategories, fetchLedger, fetchLedgerSettings } from "@/modules/ledger/queries";
import { saveEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { generateEntryCategoryMetadataAction } from "@/modules/ledger/server-actions/category-metadata";
import {
  createServiceCredentialAction,
  deleteServiceCredentialAction,
  updateServiceCredentialAction,
} from "@/modules/ledger/server-actions/credentials";
import { clearLearnedPreferencesAction } from "@/modules/ledger/server-actions/learned-preferences";
import { updateLedgerSettingsAction } from "@/modules/ledger/server-actions/update";
import { serviceCredentialsCopy, settingsCopy } from "@/copy/settings";

/** The settings the update action accepts, so the two cannot drift apart. */
type UpdateLedgerData = UpdateLedgerInput["settings"];
type QueryStatus = "pending" | "success" | "error";

interface UseLedgerSettingsParams {
  ledger: Ledger;
  initialCategories: EntryCategoryWithCount[];
}

/** 设置's server state: the ledger, its categories and API keys, and the writes to them. */
export function useLedgerSettings({
  ledger: initialLedger,
  initialCategories,
}: UseLedgerSettingsParams) {
  const queryClient = useQueryClient();
  const [metadataPollingSession, setMetadataPollingSession] = useState(0);

  const categoryMetadataPolling = useSmartPolling<EntryCategoryWithCount[]>({
    sessionKey: metadataPollingSession,
    isPollingActive: useCallback(
      (data) =>
        data?.some(
          (category) =>
            category.icon == null ||
            category.icon === "" ||
            category.description == null ||
            category.description === ""
        ) ?? false,
      []
    ),
  });

  const ledgerQuery = useQuery<Ledger | null>({
    queryKey: queryKeys.ledger(),
    queryFn: () => fetchLedger(),
    initialData: initialLedger,
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const ledger = ledgerQuery.data ?? initialLedger;

  const categoriesQuery = useQuery<EntryCategoryWithCount[]>({
    queryKey: queryKeys.entryCategories(),
    queryFn: () => fetchEntryCategories(),
    initialData: initialCategories,
    refetchInterval: categoryMetadataPolling,
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });

  const settingsQuery = useQuery<{
    uncategorizedCount: number;
    credentials: ServiceCredential[];
  }>({
    queryKey: queryKeys.ledgerSettings(),
    queryFn: () => fetchLedgerSettings(),
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const statuses = [ledgerQuery.status, categoriesQuery.status, settingsQuery.status];
  const settingsQueryStatus: QueryStatus = statuses.includes("error")
    ? "error"
    : statuses.includes("pending")
      ? "pending"
      : "success";

  const translateUpdateError = (code: UpdateLedgerActionErrorCode) => {
    switch (code) {
      case "unsupported_currency":
        return settingsCopy.unsupportedCurrency;
      case "validation_failed":
        return settingsCopy.validationFailed;
      case "unexpected":
        return settingsCopy.updateFailed;
    }
  };
  const updateLedgerMutation = useLedgerMutation<Ledger, UpdateLedgerData>({
    mutationFn: async (data) => {
      const result = await updateLedgerSettingsAction({
        settings: omitUndefinedProperties(data),
      });
      if (!result.ok) throw new Error(translateUpdateError(result.code));
      return result.ledger;
    },
    successMessage: settingsCopy.updateSuccess,
    errorMessage: null,
    onSuccess: (savedLedger) => {
      queryClient.setQueryData(queryKeys.ledger(), savedLedger);
    },
    onError: (error) => toast.error(error.message || settingsCopy.updateFailed),
  });

  const clearLearnedPreferences = useLedgerMutation<Ledger, void>({
    mutationFn: () => clearLearnedPreferencesAction(),
    successMessage: settingsCopy.clearLearnedPreferencesSuccess,
    errorMessage: settingsCopy.clearLearnedPreferencesFailed,
    onSuccess: (savedLedger) => {
      queryClient.setQueryData(queryKeys.ledger(), savedLedger);
    },
  });

  const [generatingCategoryIds, setGeneratingCategoryIds] = useState<Set<string>>(new Set());
  const [failedCategoryIds, setFailedCategoryIds] = useState<Set<string>>(new Set());
  const metadataRequestIdRef = useRef(0);
  const latestMetadataRequestRef = useRef(new Map<string, number>());
  const pendingMetadataRequestsRef = useRef(new Map<string, number>());

  const finishMetadataRequest = useCallback((categoryId: string) => {
    const remaining = Math.max(0, (pendingMetadataRequestsRef.current.get(categoryId) ?? 1) - 1);
    if (remaining > 0) {
      pendingMetadataRequestsRef.current.set(categoryId, remaining);
      return;
    }
    pendingMetadataRequestsRef.current.delete(categoryId);
    setGeneratingCategoryIds((ids) => {
      const next = new Set(ids);
      next.delete(categoryId);
      return next;
    });
  }, []);

  const generateMetadata = useLedgerMutation<
    Awaited<ReturnType<typeof generateEntryCategoryMetadataAction>>,
    { categoryId: string; requestId: number }
  >({
    mutationFn: ({ categoryId }) => generateEntryCategoryMetadataAction(categoryId),
    // Restart the category list's polling until every category has its metadata.
    onSuccess: () => setMetadataPollingSession((session) => session + 1),
    onError: (_error, { categoryId, requestId }) => {
      if (latestMetadataRequestRef.current.get(categoryId) === requestId) {
        setFailedCategoryIds((ids) => new Set(ids).add(categoryId));
      }
    },
    onSettled: (_data, _error, variables) => {
      if (variables != null) finishMetadataRequest(variables.categoryId);
    },
  });
  const requestCategoryMetadata = useCallback(
    (categoryId: string) => {
      if (pendingMetadataRequestsRef.current.has(categoryId)) return;
      const requestId = ++metadataRequestIdRef.current;
      latestMetadataRequestRef.current.set(categoryId, requestId);
      pendingMetadataRequestsRef.current.set(categoryId, 1);
      setGeneratingCategoryIds((ids) => new Set(ids).add(categoryId));
      setFailedCategoryIds((ids) => {
        const next = new Set(ids);
        next.delete(categoryId);
        return next;
      });
      generateMetadata.mutate({ categoryId, requestId });
    },
    [generateMetadata]
  );

  const saveCategories = useLedgerMutation<EntryCategory[], SaveEntryCategoriesInput>({
    mutationFn: (input) => saveEntryCategoriesAction(input),
    successMessage: settingsCopy.categoriesSaved,
    errorMessage: settingsCopy.saveCategoriesFailed,
    onSuccess: (saved, input) => {
      queryClient.setQueryData(queryKeys.entryCategories(), saved);
      for (const category of input.categories) {
        if (category.clientId != null) requestCategoryMetadata(category.clientId);
      }
    },
  });

  const createCredential = useLedgerMutation<
    CreatedServiceCredential,
    { name: string; bookId: string }
  >({
    mutationFn: (input) => createServiceCredentialAction(input),
    successMessage: settingsCopy.credentialCreated,
    errorMessage: null,
    onError: (error) => {
      const code = (error as Error & { code?: unknown }).code;
      // Two different conflicts reach here: the 20-key cap and a book that is
      // gone or archived. Reporting both as the cap hid the real reason the
      // reader could not add a key.
      if (code === "BOOK_UNAVAILABLE") toast.error(serviceCredentialsCopy.bookUnavailable);
      else if (code === "CONFLICT") toast.error(serviceCredentialsCopy.maxActive);
      else toast.error(settingsCopy.createFailed);
    },
  });

  const setCredentialBook = useLedgerMutation<ServiceCredential, { id: string; bookId: string }>({
    mutationFn: (input) => updateServiceCredentialAction(input.id, { bookId: input.bookId }),
    successMessage: settingsCopy.credentialBookChanged,
    errorMessage: settingsCopy.credentialBookChangeFailed,
  });

  const deleteCredential = useLedgerMutation<void, string>({
    mutationFn: (id) => deleteServiceCredentialAction(id),
    successMessage: settingsCopy.credentialDeleted,
    errorMessage: settingsCopy.deleteFailed,
  });

  return {
    ledger,
    categories: categoriesQuery.data ?? initialCategories,
    uncategorizedCount: settingsQuery.data?.uncategorizedCount ?? 0,
    credentials: settingsQuery.data?.credentials ?? [],
    settingsQueryStatus,
    updateLedgerMutation,
    clearLearnedPreferences,
    saveCategories,
    generatingCategoryIds,
    failedCategoryIds,
    retryCategoryMetadata: requestCategoryMetadata,
    createCredential,
    setCredentialBook,
    deleteCredential,
  };
}
