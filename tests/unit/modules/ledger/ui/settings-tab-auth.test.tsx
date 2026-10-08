import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const { queryState, refetchQueries, BOOKS } = vi.hoisted(() => ({
  queryState: { status: "success" },
  refetchQueries: vi.fn(),
  BOOKS: [
    {
      id: "book-1",
      name: "共同支出",
      timeZone: null,
      sortOrder: 1,
      archivedAt: null,
    },
  ],
}));

const { forgetLedgerDataOnThisDevice } = vi.hoisted(() => ({
  forgetLedgerDataOnThisDevice: vi.fn(),
}));

vi.mock("@/lib/sign-out-cleanup", () => ({ forgetLedgerDataOnThisDevice }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ledger/ledger-1/settings",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    refetchQueries,
  }),
  // The login-email list and the book list both read through useQuery; the
  // books are hydrated from 设置's own props, so only the emails need data here.
  useQuery: ({ initialData }: { initialData?: unknown }) => ({
    data: initialData,
    isPending: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/modules/ledger/hooks/useBooks", () => ({
  useBooks: () => ({
    books: BOOKS,
    booksQuery: { status: "success" },
  }),
}));

vi.mock("@/modules/ledger/hooks/useLedgerSettings", () => ({
  useLedgerSettings: ({ ledger }: { ledger: unknown }) => ({
    ledger,
    categories: [],
    uncategorizedCount: 0,
    credentials: [],
    settingsQueryStatus: queryState.status,
    updateLedgerMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    saveCategories: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    generatingCategoryIds: new Set<string>(),
    failedCategoryIds: new Set<string>(),
    retryCategoryMetadata: vi.fn(),
    createCredential: { mutateAsync: vi.fn(), reset: vi.fn() },
    setCredentialBook: { mutateAsync: vi.fn() },
    deleteCredential: { mutateAsync: vi.fn() },
  }),
}));

vi.mock("@/modules/ledger/ui/CurrencySection", () => ({
  CurrencySection: () => <div>Currency section</div>,
}));

vi.mock("@/modules/ledger/ui/CategorySection", () => ({
  CategorySection: () => <div>Category section</div>,
}));

vi.mock("@/modules/ledger/ui/ServiceCredentialSection", () => ({
  ServiceCredentialSection: () => <div>Service credentials</div>,
}));

import { SettingsTab } from "@/modules/ledger/ui/SettingsTab";

describe("SettingsTab account authentication controls", () => {
  beforeEach(() => {
    queryState.status = "success";
    vi.clearAllMocks();
  });
  it("shows who is signed in and offers sign-out, but no destructive account mutations", () => {
    const ledger: LedgerDto = {
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    render(
      <SettingsTab
        ledger={ledger}
        initialCategories={[]}
        initialBooks={BOOKS}
        userEmail="person@example.com"
      />
    );

    // Required: the address this session signed in with, and sign-out. Who may
    // sign in is the identity provider's decision, so there is nothing to manage.
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out|退出登录/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /添加邮箱|移除/ })).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /clear data|清空数据/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete account|删除账户/i })
    ).not.toBeInTheDocument();
  });

  it("runs from the short preferences to the lists, and ends with signing out", () => {
    const ledger: LedgerDto = {
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    render(<SettingsTab ledger={ledger} initialCategories={[]} initialBooks={BOOKS} />);

    // The cards carry no titles of their own: every heading is a field's, and
    // 分类 and API 密钥 are stubbed here, so theirs are not among these.
    const cards = Array.from(document.querySelectorAll("section"));
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(
      cards.map((card) =>
        within(card)
          .queryAllByRole("heading", { level: 3 })
          .map((heading) => heading.textContent)
      )
    ).toContainEqual(["主题", "默认折叠账单"]);
    // One 账户 card: signing out only, since this session records no address.
    expect(
      within(cards.at(-1)!)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(["在这台设备上退出"]);
  });

  it("clears this device's drafts and remembered book when the reader signs out", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    const logout = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", logout);
    const ledger: LedgerDto = {
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    render(
      <SettingsTab
        ledger={ledger}
        initialCategories={[]}
        initialBooks={BOOKS}
        userEmail="person@example.com"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /退出登录/ }));
    const confirm = await screen.findByRole("dialog");
    fireEvent.click(within(confirm).getByRole("button", { name: /退出登录/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?notice=signed_out"));
    expect(logout).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(forgetLedgerDataOnThisDevice).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("keeps loaded settings visible when a query fails and exposes a local retry", () => {
    queryState.status = "error";
    const ledger: LedgerDto = {
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    render(
      <SettingsTab
        ledger={ledger}
        initialCategories={[]}
        initialBooks={BOOKS}
        userEmail="person@example.com"
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out|退出登录/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    // Retrying reads every ledger query on the page again, both book lists
    // included; there is no list of which ones 设置 happens to hold.
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: ["ledger"], type: "active" });
  });
});
