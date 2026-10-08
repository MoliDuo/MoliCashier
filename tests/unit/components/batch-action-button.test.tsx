import { render, screen } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { describe, expect, it } from "vitest";
import { BatchActionButton } from "@/components/batch-action-button";

describe("BatchActionButton", () => {
  it.each(["row", "stacked"] as const)(
    "names the whole action where a %s button shows only the short label",
    (orientation) => {
      render(
        <BatchActionButton icon={Trash2} shortLabel="删除" orientation={orientation}>
          删除所选账单
        </BatchActionButton>
      );

      expect(screen.getByRole("button", { name: "删除所选账单" })).toBeInTheDocument();
    }
  );

  it("keeps its visible label as the name when there is no short one", () => {
    render(<BatchActionButton icon={Trash2}>删除</BatchActionButton>);

    expect(screen.getByRole("button", { name: "删除" })).not.toHaveAttribute("aria-label");
  });
});
