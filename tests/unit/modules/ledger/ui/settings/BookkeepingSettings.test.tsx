import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookkeepingSettings } from "@/modules/ledger/ui/settings/BookkeepingSettings";
import type { ComponentProps } from "react";
import { getDefaultLedger } from "tests/helpers/default-ledger";
import { commonCopy } from "@/copy/common";
import { settingsCopy } from "@/copy/settings";

vi.mock("@/modules/ledger/ui/CurrencySection", () => ({
  CurrencySection: () => <div>currency-section</div>,
}));

vi.mock("@/modules/ledger/ui/CategorySection", () => ({
  CategorySection: () => <div>category-section</div>,
}));

type BookkeepingProps = ComponentProps<typeof BookkeepingSettings>;

/**
 * 外观, 时区与货币 and AI 解析 share one save, so the cases render them together
 * and override only the props the case cares about.
 */
const bookkeepingProps = (overrides: Partial<BookkeepingProps>): BookkeepingProps => ({
  settings: getDefaultLedger().settings,
  categories: [],
  uncategorizedCount: 0,
  onUpdateSettings: () => Promise.reject(new Error("unexpected save")),
  onClearLearnedPreferences: () => Promise.reject(new Error("unexpected clear")),
  onSaveCategories: () => Promise.resolve([]),
  generatingCategoryIds: new Set(),
  failedCategoryIds: new Set(),
  onRetryMetadata: () => {},
  isSavingCategories: false,
  ...overrides,
});

describe("instant bookkeeping settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const savedLedger = (settings: Partial<BookkeepingProps["settings"]>) => ({
    id: "ledger-1",
    userId: "user-1",
    settings: { ...getDefaultLedger().settings, ...settings },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  it("saves a switch the moment it changes, holding the fields until the save lands", async () => {
    let resolveSave: (value: ReturnType<typeof savedLedger>) => void = () => {};
    const onUpdateSettings = vi.fn(
      () => new Promise<ReturnType<typeof savedLedger>>((resolve) => (resolveSave = resolve))
    );
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, collapseEntriesDefault: false },
          onUpdateSettings,
        })}
      />
    );

    const toggle = screen.getByRole("switch", { name: settingsCopy.collapseEntries });
    fireEvent.click(toggle);

    expect(onUpdateSettings).toHaveBeenCalledWith({ collapseEntriesDefault: true });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    await act(async () => resolveSave(savedLedger({ collapseEntriesDefault: true })));
    expect(toggle).toBeEnabled();
    expect(screen.queryByRole("button", { name: commonCopy.save })).not.toBeInTheDocument();
  });

  it("falls back to the saved value when the save fails", async () => {
    const onUpdateSettings = vi.fn().mockRejectedValue(new Error("conflict"));
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, collapseEntriesDefault: false },
          onUpdateSettings,
        })}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: settingsCopy.collapseEntries }));

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: settingsCopy.collapseEntries })).not.toBeChecked()
    );
  });

  it("saves the prompt when the reader leaves the field, not on every keystroke", async () => {
    const onUpdateSettings = vi
      .fn()
      .mockResolvedValue(savedLedger({ aiCustomPrompt: "Draft prompt" }));
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, aiCustomPrompt: "Server prompt" },
          onUpdateSettings,
        })}
      />
    );

    const prompt = screen.getByRole("textbox", { name: settingsCopy.aiPrompt });
    fireEvent.change(prompt, { target: { value: "Draft" } });
    fireEvent.change(prompt, { target: { value: "Draft prompt" } });
    expect(onUpdateSettings).not.toHaveBeenCalled();

    fireEvent.blur(prompt);
    await waitFor(() =>
      expect(onUpdateSettings).toHaveBeenCalledWith({ aiCustomPrompt: "Draft prompt" })
    );
    expect(onUpdateSettings).toHaveBeenCalledOnce();
  });

  it("does not save a prompt that was left as it was", () => {
    const onUpdateSettings = vi.fn();
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, aiCustomPrompt: "Server prompt" },
          onUpdateSettings,
        })}
      />
    );

    const prompt = screen.getByRole("textbox", { name: settingsCopy.aiPrompt });
    fireEvent.change(prompt, { target: { value: "Server prompt" } });
    fireEvent.blur(prompt);

    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it("saves a prompt still being typed when the section goes away", () => {
    const onUpdateSettings = vi
      .fn()
      .mockResolvedValue(savedLedger({ aiCustomPrompt: "Typed then left" }));
    const { unmount } = render(<BookkeepingSettings {...bookkeepingProps({ onUpdateSettings })} />);

    fireEvent.change(screen.getByRole("textbox", { name: settingsCopy.aiPrompt }), {
      target: { value: "Typed then left" },
    });
    unmount();

    expect(onUpdateSettings).toHaveBeenCalledWith({ aiCustomPrompt: "Typed then left" });
  });

  describe("learned preferences", () => {
    it("saves the learned text when the reader leaves the field", async () => {
      const onUpdateSettings = vi.fn().mockResolvedValue(savedLedger({}));
      render(
        <BookkeepingSettings
          {...bookkeepingProps({
            settings: { ...getDefaultLedger().settings, aiLearnedPreferences: "- 星巴克算餐饮" },
            onUpdateSettings,
          })}
        />
      );

      const field = screen.getByRole("textbox", { name: settingsCopy.learnedPreferences });
      fireEvent.change(field, { target: { value: "- 星巴克算饮品" } });
      expect(onUpdateSettings).not.toHaveBeenCalled();
      fireEvent.blur(field);

      await waitFor(() =>
        expect(onUpdateSettings).toHaveBeenCalledWith({ aiLearnedPreferences: "- 星巴克算饮品" })
      );
    });

    it("saves the learning switch the moment it changes", () => {
      const onUpdateSettings = vi.fn().mockResolvedValue(savedLedger({}));
      render(<BookkeepingSettings {...bookkeepingProps({ onUpdateSettings })} />);

      fireEvent.click(screen.getByRole("switch", { name: settingsCopy.learnPreferences }));

      expect(onUpdateSettings).toHaveBeenCalledWith({ aiPreferenceLearningEnabled: false });
    });

    it("clears only after the reader confirms", async () => {
      const onClearLearnedPreferences = vi.fn().mockResolvedValue(savedLedger({}));
      render(
        <BookkeepingSettings
          {...bookkeepingProps({
            settings: { ...getDefaultLedger().settings, aiLearnedPreferences: "- 星巴克算餐饮" },
            onClearLearnedPreferences,
          })}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: settingsCopy.clearLearnedPreferences }));
      expect(onClearLearnedPreferences).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: settingsCopy.clearLearnedPreferences })
      );

      await waitFor(() => expect(onClearLearnedPreferences).toHaveBeenCalledTimes(1));
    });

    it("has nothing to clear before anything was learned", () => {
      render(<BookkeepingSettings {...bookkeepingProps({})} />);

      expect(
        screen.getByRole("button", { name: settingsCopy.clearLearnedPreferences })
      ).toBeDisabled();
    });
  });

  it("offers the ledger's own zone even when it is not one of the listed ones", () => {
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, timeZone: "Pacific/Auckland" },
        })}
      />
    );

    expect(screen.getByRole("combobox", { name: settingsCopy.timeZone })).toHaveTextContent(
      "Pacific/Auckland"
    );
  });
});
