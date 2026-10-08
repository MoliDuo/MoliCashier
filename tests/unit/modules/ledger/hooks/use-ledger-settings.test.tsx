import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import type {
  CreatedServiceCredentialDto,
  EntryCategory,
  Ledger,
} from "@/modules/ledger/contracts";
import { useLedgerSettings } from "@/modules/ledger/hooks/useLedgerSettings";
import { getDefaultLedger } from "tests/helpers/default-ledger";
import { serviceCredentialsCopy, settingsCopy } from "@/copy/settings";

const {
  updateLedgerSettingsAction,
  saveAction,
  metadataAction,
  createServiceCredentialAction,
  fetchLedgerSettings,
  pollingSessions,
  toastError,
} = vi.hoisted(() => ({
  updateLedgerSettingsAction: vi.fn(),
  saveAction: vi.fn(),
  metadataAction: vi.fn(),
  createServiceCredentialAction: vi.fn(),
  fetchLedgerSettings: vi.fn(),
  pollingSessions: [] as Array<number | string>,
  toastError: vi.fn(),
}));

vi.mock("@/modules/ledger/server-actions/update", () => ({ updateLedgerSettingsAction }));
vi.mock("@/modules/ledger/server-actions/categories", () => ({
  saveEntryCategoriesAction: saveAction,
}));
vi.mock("@/modules/ledger/server-actions/category-metadata", () => ({
  generateEntryCategoryMetadataAction: metadataAction,
}));
vi.mock("@/modules/ledger/server-actions/credentials", () => ({
  createServiceCredentialAction,
  deleteServiceCredentialAction: vi.fn(),
  updateServiceCredentialAction: vi.fn(),
}));
vi.mock("@/modules/ledger/queries", () => ({
  fetchLedger: vi.fn(),
  fetchEntryCategories: vi.fn(async () => []),
  fetchLedgerSettings,
}));
vi.mock("@/hooks/use-smart-polling", () => ({
  useSmartPolling: ({ sessionKey }: { sessionKey: number | string }) => {
    pollingSessions.push(sessionKey);
    return false;
  },
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), warning: vi.fn() },
}));

const ledger: Ledger = {
  settings: { ...getDefaultLedger().settings, currencies: ["USD", "CNY"] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const category: EntryCategory = {
  id: "category-1",
  name: "Food",
  sortOrder: 0,
  icon: null,
  description: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const createdCredential: CreatedServiceCredentialDto = {
  bookId: "user-1",
  id: "credential-1",
  name: "CLI",
  tokenPrefix: "cashier_",
  tokenSuffix: "abcd",
  token: "cashier_secret_token",
  createdAt: "2026-08-06T00:00:00.000Z",
  lastUsedAt: null,
  deletedAt: null,
};

function setup(queryClient = createQueryClient()) {
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useLedgerSettings({ ledger, initialCategories: [] }), {
    wrapper,
  });
  return { ...hook, queryClient };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

const UNSUPPORTED_CURRENCY_MESSAGE = "所选币种暂不受汇率数据支持";

describe("useLedgerSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pollingSessions.length = 0;
    metadataAction.mockResolvedValue({ categoryId: category.id });
    fetchLedgerSettings.mockResolvedValue({ uncategorizedCount: 0, credentials: [] });
  });

  describe("settings update", () => {
    it("submits the stream collapse preference", async () => {
      updateLedgerSettingsAction.mockResolvedValueOnce({ ok: true, ledger });
      const { result } = setup();

      await act(async () =>
        result.current.updateLedgerMutation.mutateAsync({ collapseEntriesDefault: true })
      );

      expect(updateLedgerSettingsAction).toHaveBeenCalledWith({
        settings: { collapseEntriesDefault: true },
      });
    });

    it("submits preferred currencies through the currencies field", async () => {
      updateLedgerSettingsAction.mockResolvedValueOnce({ ok: true, ledger });
      const { result } = setup();

      await act(async () =>
        result.current.updateLedgerMutation.mutateAsync({ currencies: ["USD", "CNY"] })
      );

      expect(updateLedgerSettingsAction).toHaveBeenCalledWith({
        settings: { currencies: ["USD", "CNY"] },
      });
    });

    it("localizes action failures without invalidating queries", async () => {
      updateLedgerSettingsAction.mockResolvedValueOnce({
        ok: false,
        code: "unsupported_currency",
      });
      const { result, queryClient } = setup();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      await act(async () => {
        await expect(
          result.current.updateLedgerMutation.mutateAsync({ mainCurrency: "USD" })
        ).rejects.toThrow(UNSUPPORTED_CURRENCY_MESSAGE);
      });

      expect(toastError).toHaveBeenCalledWith(UNSUPPORTED_CURRENCY_MESSAGE);
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe("category saves", () => {
    it("does not invalidate server state after a failed write", async () => {
      const { result, queryClient } = setup();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      saveAction.mockRejectedValue(new Error("create failed"));

      await act(async () => {
        await expect(
          result.current.saveCategories.mutateAsync({
            expectedRevision: "a".repeat(64),
            categories: [],
          })
        ).rejects.toThrow("create failed");
      });

      expect(invalidate).not.toHaveBeenCalled();
    });

    it("stores saved categories with their entry counts and refreshes the visible ledger", async () => {
      const { result, queryClient } = setup();
      queryClient.setQueryData(queryKeys.entryCategories(), [{ ...category, entryCount: 3 }]);
      saveAction.mockResolvedValue({ ok: true, categories: [{ ...category, name: "Dining" }] });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

      await act(async () => {
        await result.current.saveCategories.mutateAsync({
          expectedRevision: "a".repeat(64),
          categories: [{ id: category.id, name: "Dining", description: null, icon: null }],
        });
      });

      expect(queryClient.getQueryData(queryKeys.entryCategories())).toEqual([
        { ...category, name: "Dining", entryCount: 3 },
      ]);
      expect(invalidate.mock.calls.map(([filters]) => filters!.queryKey)).toEqual([
        queryKeys.ledger(),
      ]);
    });

    it("keeps a save pending until broad invalidation settles", async () => {
      const { result, queryClient } = setup();
      let resolveRefresh!: () => void;
      const refresh = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });
      vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(refresh);
      saveAction.mockResolvedValue({ ok: true, categories: [{ ...category, name: "Dining" }] });

      let mutation!: Promise<EntryCategory[]>;
      act(() => {
        mutation = result.current.saveCategories.mutateAsync({
          expectedRevision: "a".repeat(64),
          categories: [{ id: category.id, name: "Dining", description: null, icon: null }],
        });
      });
      await waitFor(() => expect(result.current.saveCategories.isPending).toBe(true));

      await act(async () => {
        resolveRefresh();
        await mutation;
      });
      await waitFor(() => expect(result.current.saveCategories.isSuccess).toBe(true));
    });

    it("tracks metadata generation until its invalidation finishes", async () => {
      const { result, queryClient } = setup();
      vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

      act(() => result.current.retryCategoryMetadata(category.id));
      expect(result.current.generatingCategoryIds.has(category.id)).toBe(true);
      await waitFor(() =>
        expect(result.current.generatingCategoryIds.has(category.id)).toBe(false)
      );
      expect(result.current.failedCategoryIds.has(category.id)).toBe(false);
    });

    it("starts category polling only after metadata generation succeeds", async () => {
      const { result, queryClient } = setup();
      vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
      expect(pollingSessions.at(-1)).toBe(0);

      metadataAction.mockRejectedValueOnce(new Error("offline"));
      act(() => result.current.retryCategoryMetadata(category.id));
      await waitFor(() => expect(result.current.failedCategoryIds.has(category.id)).toBe(true));
      expect(pollingSessions.at(-1)).toBe(0);

      act(() => result.current.retryCategoryMetadata(category.id));
      await waitFor(() => expect(pollingSessions.at(-1)).toBe(1));
      expect(result.current.failedCategoryIds.has(category.id)).toBe(false);
    });
  });

  describe("API keys", () => {
    it("keeps the one-time token out of the settings query cache", async () => {
      const queryClient = createQueryClient();
      queryClient.setQueryData(queryKeys.ledgerSettings(), {
        uncategorizedCount: 0,
        credentials: [],
      });
      createServiceCredentialAction.mockResolvedValueOnce({
        ok: true,
        credential: createdCredential,
      });
      const { result } = setup(queryClient);

      let returned: CreatedServiceCredentialDto | undefined;
      await act(async () => {
        returned = await result.current.createCredential.mutateAsync({
          name: "CLI",
          bookId: "book-1",
        });
      });

      expect(returned?.token).toBe(createdCredential.token);
      const cached = queryClient.getQueryData<{
        credentials: Array<Record<string, unknown>>;
      }>(queryKeys.ledgerSettings());
      expect(cached?.credentials).toEqual([]);
      expect(JSON.stringify(cached)).not.toContain(createdCredential.token);
    });

    it("clears mutation data when the one-time result is dismissed", async () => {
      createServiceCredentialAction.mockResolvedValueOnce({
        ok: true,
        credential: createdCredential,
      });
      const { result } = setup();

      await act(async () => {
        await result.current.createCredential.mutateAsync({ name: "CLI", bookId: "book-1" });
      });
      await waitFor(() =>
        expect(result.current.createCredential.data?.token).toBe(createdCredential.token)
      );

      act(() => result.current.createCredential.reset());

      await waitFor(() => expect(result.current.createCredential.data).toBeUndefined());
    });

    it.each([
      ["book_unavailable", serviceCredentialsCopy.bookUnavailable],
      ["limit_reached", serviceCredentialsCopy.maxActive],
      ["unexpected", settingsCopy.createFailed],
    ] as const)("explains a key refused with %s", async (code, message) => {
      createServiceCredentialAction.mockResolvedValueOnce({ ok: false, code });
      const { result } = setup();

      await act(async () => {
        await expect(
          result.current.createCredential.mutateAsync({ name: "CLI", bookId: "book-1" })
        ).rejects.toMatchObject({ code });
      });

      expect(toastError).toHaveBeenCalledExactlyOnceWith(message);
    });
  });

  describe("category save refusals", () => {
    it.each([
      ["assignment_active", settingsCopy.categoryAssignmentActive],
      ["invalid", settingsCopy.saveCategoriesFailed],
    ] as const)("explains a save refused with %s", async (code, message) => {
      saveAction.mockResolvedValueOnce({ ok: false, code });
      const { result } = setup();

      await act(async () => {
        await expect(
          result.current.saveCategories.mutateAsync({
            expectedRevision: "a".repeat(64),
            categories: [],
          })
        ).rejects.toMatchObject({ code });
      });

      expect(toastError).toHaveBeenCalledExactlyOnceWith(message);
    });

    it("leaves a conflict to the section, which offers to reload", async () => {
      saveAction.mockResolvedValueOnce({ ok: false, code: "conflict" });
      const { result } = setup();

      await act(async () => {
        await expect(
          result.current.saveCategories.mutateAsync({
            expectedRevision: "a".repeat(64),
            categories: [],
          })
        ).rejects.toMatchObject({ code: "conflict" });
      });

      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
