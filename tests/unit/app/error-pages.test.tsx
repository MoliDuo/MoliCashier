import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/error";
import { errorCopy } from "@/copy/app";

const originalLocation = window.location;

describe("error boundary retry buttons", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("hard-refreshes from the global error page instead of calling reset", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("describes the error instead of repeating its title", () => {
    render(
      <GlobalError error={Object.assign(new Error("boom"), { digest: "abc" })} reset={vi.fn()} />
    );

    expect(screen.getByText(errorCopy.description)).toBeInTheDocument();
    expect(screen.getByText(errorCopy.errorId({ id: "abc" }))).toBeInTheDocument();
  });
});
