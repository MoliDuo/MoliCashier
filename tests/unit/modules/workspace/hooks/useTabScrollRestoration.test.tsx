import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabScrollRestoration } from "@/modules/workspace/hooks/useTabScrollRestoration";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";

function Harness({ tab }: { tab: LedgerTab }) {
  useTabScrollRestoration(tab);
  return <div />;
}

describe("useTabScrollRestoration", () => {
  let scrollY = 0;
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.restoreAllMocks();
    scrollY = 0;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 3000,
    });
    vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const options = args[0];
      if (typeof options === "object" && options != null && "top" in options) {
        scrollY = Number(options.top ?? 0);
      }
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it("remembers an independent vertical position for every tab", () => {
    const view = render(<Harness tab="records" />);
    scrollY = 640;

    act(() => view.rerender(<Harness tab="stats" />));
    expect(scrollY).toBe(0);
    scrollY = 220;

    act(() => view.rerender(<Harness tab="records" />));
    expect(scrollY).toBe(640);

    act(() => view.rerender(<Harness tab="stats" />));
    expect(scrollY).toBe(220);
  });

  it("never scrolls again after successful restoration", () => {
    vi.useFakeTimers();
    render(<Harness tab="records" />);
    scrollY = 450;
    act(() => vi.advanceTimersByTime(2000));
    expect(scrollY).toBe(450);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("cancels the clamp timer when growing content permits restoration", () => {
    vi.useFakeTimers();
    let resize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const view = render(<Harness tab="records" />);
    scrollY = 640;
    view.rerender(<Harness tab="stats" />);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 800,
    });
    view.rerender(<Harness tab="records" />);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 3000,
    });
    act(() => resize([], {} as ResizeObserver));
    expect(scrollY).toBe(640);
    scrollY = 900;
    act(() => vi.advanceTimersByTime(2000));
    expect(scrollY).toBe(900);
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
