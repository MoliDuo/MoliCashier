import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonCopy } from "@/copy/common";
import { settingsCopy } from "@/copy/settings";
import type { EntryCategoryWithCountDto } from "@/modules/ledger/contracts";
import { CategorySection } from "@/modules/ledger/ui/CategorySection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/ledger/ui/category-assignment-context", () => ({
  useCategoryAssignment: () => ({
    job: null,
    isActive: false,
    isReadError: false,
    refresh: vi.fn(),
    dismiss: vi.fn(),
    registerSubmittedJob: vi.fn(),
  }),
}));

const category: EntryCategoryWithCountDto = {
  id: "category-1",
  name: "Meals",
  description: null,
  icon: null,
  sortOrder: 0,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  entryCount: 3,
};

function renderSection(
  props: { uncategorizedCount?: number; categories?: EntryCategoryWithCountDto[] } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const onSaveCategories = vi
    .fn()
    .mockResolvedValue([category, { ...category, id: "category-2", name: "Travel", sortOrder: 1 }]);
  const view = render(
    <CategorySection categories={[category]} onSaveCategories={onSaveCategories} {...props} />,
    { wrapper }
  );
  const rerender = (categories: EntryCategoryWithCountDto[]) =>
    view.rerender(<CategorySection categories={categories} onSaveCategories={onSaveCategories} />);
  return { onSaveCategories, rerender, unmount: view.unmount };
}

describe("CategorySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  async function addTravel() {
    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.manageCategories }));
    fireEvent.change(screen.getByLabelText(settingsCopy.newCategoryPlaceholder), {
      target: { value: "Travel" },
    });
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.addCategory }));
  }

  it("restores unsaved list edits after the page goes away, and discards them on request", async () => {
    const first = renderSection();
    await addTravel();
    first.unmount();

    const second = renderSection();

    expect(await screen.findByText("Travel")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(commonCopy.draftRestored);
    fireEvent.click(screen.getByRole("button", { name: commonCopy.discard }));

    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: settingsCopy.manageCategories })).toBeInTheDocument();
    second.unmount();
    renderSection();
    expect(screen.getByRole("button", { name: settingsCopy.manageCategories })).toBeInTheDocument();
  });

  it("follows the server while the list is untouched", async () => {
    const { rerender } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.manageCategories }));

    rerender([{ ...category, name: "Food" }]);

    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByText(settingsCopy.categoriesChangedElsewhere)).not.toBeInTheDocument();
  });

  it("refuses to save edits over a list that changed elsewhere and offers the latest", async () => {
    const { onSaveCategories, rerender } = renderSection();
    await addTravel();

    rerender([{ ...category, name: "Food" }]);

    expect(screen.getByText(settingsCopy.categoriesChangedElsewhere)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: commonCopy.save })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.reloadCategories }));

    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
    expect(onSaveCategories).not.toHaveBeenCalled();
  });

  it("asks before an explicit cancel throws the list edits away", async () => {
    renderSection();
    await addTravel();

    fireEvent.click(screen.getByRole("button", { name: commonCopy.cancel }));
    fireEvent.click(await screen.findByRole("button", { name: commonCopy.discard }));

    await waitFor(() => expect(screen.queryByText("Travel")).not.toBeInTheDocument());
  });

  it("keeps category changes in a draft and submits them atomically", async () => {
    const { onSaveCategories } = renderSection();

    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.manageCategories }));
    fireEvent.change(screen.getByLabelText(settingsCopy.newCategoryPlaceholder), {
      target: { value: "Travel" },
    });
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.addCategory }));

    expect(onSaveCategories).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: commonCopy.save }));
    await waitFor(() => expect(onSaveCategories).toHaveBeenCalledOnce());
    expect(onSaveCategories).toHaveBeenCalledWith({
      expectedRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      categories: [
        {
          id: "category-1",
          name: "Meals",
          description: null,
          icon: null,
        },
        {
          clientId: expect.any(String),
          name: "Travel",
          description: null,
          icon: null,
        },
      ],
    });
  });

  it("offers managing categories as the section's only action", async () => {
    renderSection();

    const manage = await screen.findByRole("button", { name: settingsCopy.manageCategories });
    expect(manage).toBeEnabled();
    expect(screen.queryByRole("button", { name: "切换预设" })).toBeNull();
    expect(screen.queryByText("切换预设")).toBeNull();
  });

  it("holds 未分类 in the last slot with nothing to press", async () => {
    renderSection({ uncategorizedCount: 2 });

    const row = await screen.findByTestId("uncategorized-row");
    expect(row).toHaveTextContent(settingsCopy.uncategorized);
    expect(row).toHaveTextContent(settingsCopy.categoryItemCount({ count: 2 }));

    // Below the last category, and out of reach of the editor: managing the
    // list adds no control to it, because there is no category behind it.
    const list = row.parentElement!;
    expect(list.lastElementChild).toBe(row);

    fireEvent.click(screen.getByRole("button", { name: settingsCopy.manageCategories }));

    expect(screen.getByTestId("uncategorized-row")).toBe(list.lastElementChild);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });
});
