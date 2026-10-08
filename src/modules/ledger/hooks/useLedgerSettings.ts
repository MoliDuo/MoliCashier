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
import { ActionRefusedError, refusalCode } from "@/lib/errors";
import type {
  CreateServiceCredentialErrorCode,
  CreatedServiceCredentialDto,
  EntryCategoryDto,
  EntryCategoryWithCountDto,
  LedgerDto,
  SaveEntryCategoriesErrorCode,
  SaveEntryCategoriesInput,
  ServiceCredentialDto,
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
  ledger: LedgerDto;
  initialCategories: EntryCategoryWithCountDto[];
}

/** 设置's server state: the ledger, its categories and API keys, and the writes to them. */
export function useLedgerSettings({
  ledger: initialLedger,
  initialCategories,
}: UseLedgerSettingsParams) {
  const queryClient = useQueryClient();
  const [metadataPollingSession, setMetadataPollingSession] = useState(0);

  const categoryMetadataPolling = useSmartPolling<EntryCategoryWithCountDto[]>({
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

  const ledgerQuery = useQuery<LedgerDto | null>({
    queryKey: queryKeys.ledger(),
    queryFn: ({ signal }) => fetchLedger({ signal }),
    initialData: initialLedger,
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const ledger = ledgerQuery.data ?? initialLedger;

  const categoriesQuery = useQuery<EntryCategoryWithCountDto[]>({
    queryKey: queryKeys.entryCategories(),
    queryFn: ({ signal }) => fetchEntryCategories({ signal }),
    initialData: initialCategories,
    refetchInterval: categoryMetadataPolling,
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });

  const settingsQuery = useQuery<{
    uncategorizedCount: number;
    credentials: ServiceCredentialDto[];
  }>({
    queryKey: queryKeys.ledgerSettings(),
    queryFn: ({ signal }) => fetchLedgerSettings({ signal }),
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
  const updateLedgerMutation = useLedgerMutation<LedgerDto, UpdateLedgerData>({
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

  const clearLearnedPreferences = useLedgerMutation<LedgerDto, void>({
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
    // The category's row shows the failure and offers to try again.
    errorMessage: null,
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

  const saveCategories = useLedgerMutation<EntryCategoryDto[], SaveEntryCategoriesInput>({
    mutationFn: async (input) => {
      const result = await saveEntryCategoriesAction(input);
      if (!result.ok) throw new ActionRefusedError<SaveEntryCategoriesErrorCode>(result.code);
      return result.categories;
    },
    successMessage: settingsCopy.categoriesSaved,
    errorMessage: null,
    onSuccess: (saved, input) => {
      // The list keeps each category's entry count, which a save does not
      // change; a new category has none yet.
      queryClient.setQueryData<EntryCategoryWithCountDto[]>(
        queryKeys.entryCategories(),
        (previous) => {
          const counts = new Map(previous?.map((category) => [category.id, category.entryCount]));
          return saved.map((category) => ({
            ...category,
            entryCount: counts.get(category.id) ?? 0,
          }));
        }
      );
      for (const category of input.categories) {
        if (category.clientId != null) requestCategoryMetadata(category.clientId);
      }
    },
    onError: (error) => {
      // A conflict is shown in the section itself, with the way to reload.
      const code = refusalCode<SaveEntryCategoriesErrorCode>(error);
      if (code === "conflict") return;
      toast.error(
        code === "assignment_active"
          ? settingsCopy.categoryAssignmentActive
          : settingsCopy.saveCategoriesFailed
      );
    },
  });

  const createCredential = useLedgerMutation<
    CreatedServiceCredentialDto,
    { name: string; bookId: string }
  >({
    mutationFn: async (input) => {
      const result = await createServiceCredentialAction(input);
      if (!result.ok) throw new ActionRefusedError<CreateServiceCredentialErrorCode>(result.code);
      return result.credential;
    },
    successMessage: settingsCopy.credentialCreated,
    errorMessage: null,
    onError: (error) => {
      // Two different conflicts reach here: the 20-key cap and a book that is
      // gone or archived. Reporting both as the cap hid the real reason the
      // reader could not add a key.
      const code = refusalCode<CreateServiceCredentialErrorCode>(error);
      if (code === "book_unavailable") toast.error(serviceCredentialsCopy.bookUnavailable);
      else if (code === "limit_reached") toast.error(serviceCredentialsCopy.maxActive);
      else toast.error(settingsCopy.createFailed);
    },
  });

  const setCredentialBook = useLedgerMutation<ServiceCredentialDto, { id: string; bookId: string }>(
    {
      mutationFn: (input) => updateServiceCredentialAction(input.id, { bookId: input.bookId }),
      successMessage: settingsCopy.credentialBookChanged,
      errorMessage: settingsCopy.credentialBookChangeFailed,
    }
  );

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
