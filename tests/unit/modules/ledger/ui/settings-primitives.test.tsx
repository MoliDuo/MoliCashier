import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CurrencySection } from "@/modules/ledger/ui/CurrencySection";
import { SettingsField } from "@/components/SettingsField";

describe("settings primitives", () => {
  it("updates the main-currency draft without opening a confirmation", () => {
    const onUpdateSettings = vi.fn();
    render(
      <CurrencySection
        settings={{ mainCurrency: "CNY", currencies: ["CNY"] }}
        onUpdateSettings={onUpdateSettings}
      />
    );

    fireEvent.click(screen.getByRole("combobox", { name: "主货币" }));
    fireEvent.click(screen.getByRole("option", { name: "USD" }));

    expect(onUpdateSettings).toHaveBeenCalledWith({
      mainCurrency: "USD",
      currencies: ["CNY", "USD"],
    });
    expect(screen.queryByText("更改主货币？")).not.toBeInTheDocument();
  });

  it("searches and toggles preferred currencies in the section draft", () => {
    const onUpdateSettings = vi.fn();
    render(
      <CurrencySection
        settings={{ mainCurrency: "CNY", currencies: ["CNY", "USD"] }}
        onUpdateSettings={onUpdateSettings}
      />
    );

    const trigger = screen.getByRole("button", { name: /preferred currencies|偏好货币/i });
    expect(trigger).toHaveTextContent(/CNY, USD/);
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText(/search currencies|搜索币种/i), {
      target: { value: "jp" },
    });
    expect(screen.getByText("JPY")).toBeInTheDocument();
    expect(screen.queryByText("USD")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("JPY"));
    expect(onUpdateSettings).toHaveBeenCalledWith({ currencies: ["CNY", "USD", "JPY"] });
  });
});

describe("SettingsField", () => {
  it("keeps an inline control beside its title, and stacks the others under it on a phone", () => {
    const { container, rerender } = render(
      <SettingsField title="默认折叠账单" inline>
        <button type="button">开关</button>
      </SettingsField>
    );
    expect(container.firstElementChild).toHaveClass("flex-row");
    expect(container.firstElementChild).not.toHaveClass("flex-col");

    rerender(
      <SettingsField title="时区">
        <button type="button">选择</button>
      </SettingsField>
    );
    expect(container.firstElementChild).toHaveClass("flex-col", "sm:flex-row");
  });
});
