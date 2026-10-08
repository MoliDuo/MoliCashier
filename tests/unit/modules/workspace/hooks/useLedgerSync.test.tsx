import { act, renderHook } from "@testing-library/react";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStreamRefreshActionMock } = vi.hoisted(() => ({
  getStreamRefreshActionMock: vi.fn(),
}));

vi.mock("@/modules/source-document/queries", () => ({
  fetchStreamRefresh: getStreamRefreshActionMock,
}));

import { useQuery } from "@tanstack/react-query";
import { useLedgerSync } from "@/modules/workspace/hooks/useLedgerSync";
import { queryKeys } from "@/lib/query-keys";

const unchanged = {
  version: "1",
  changed: false,
  hasTransitionalWork: false,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useLedgerSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    getStreamRefreshActionMock.mockReset();
  });

  afterEach(() => {
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("polls every three seconds while transitional work remains", async () => {
    getStreamRefreshActionMock
      .mockResolvedValueOnce({ ...unchanged, version: "1", hasTransitionalWork: true })
      .mockResolvedValueOnce({ ...unchanged, version: "2" });
    const { wrapper } = setup();

    renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledWith(
      {
        afterVersion: "0",
      },
      { signal: expect.any(AbortSignal) }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenLastCalledWith(
      {
        afterVersion: "1",
      },
      { signal: expect.any(AbortSignal) }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);
  });

  it("checks every thirty seconds while nothing is processing", async () => {
    getStreamRefreshActionMock.mockResolvedValue(unchanged);
    const { wrapper } = setup();

    renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);
  });

  it("uses a hydrated baseline without refreshing during the three-second stale window", async () => {
    getStreamRefreshActionMock.mockResolvedValue(unchanged);
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.ledgerSync(), {
      ...unchanged,
      version: "7",
      hasTransitionalWork: true,
    });

    renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(getStreamRefreshActionMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledWith(
      {
        afterVersion: "7",
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it("retries after three seconds when the initial refresh fails", async () => {
    getStreamRefreshActionMock
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(unchanged);
    const { wrapper } = setup();

    const { result } = renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isError).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenLastCalledWith(
      {
        afterVersion: "0",
      },
      { signal: expect.any(AbortSignal) }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);
  });

  it("backs off consecutive failures to the thirty-second cap", async () => {
    getStreamRefreshActionMock.mockRejectedValue(new Error("temporary outage"));
    const { wrapper } = setup();

    renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    const intervals = [3_000, 6_000, 12_000, 24_000, 30_000, 30_000];
    for (const [index, interval] of intervals.entries()) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval - 1);
      });
      expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(index + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(index + 2);
    }
  });

  it("pauses in the background and refreshes on focus and reconnect", async () => {
    getStreamRefreshActionMock
      .mockResolvedValueOnce({ ...unchanged, hasTransitionalWork: true })
      .mockResolvedValue(unchanged);
    const { wrapper } = setup();

    renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    focusManager.setFocused(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    focusManager.setFocused(true);
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight request for observers of the same ledger", async () => {
    let resolve!: (value: typeof unchanged) => void;
    getStreamRefreshActionMock.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      })
    );
    const { wrapper } = setup();

    renderHook(() => useLedgerSync(), { wrapper });
    renderHook(() => useLedgerSync(), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    resolve(unchanged);
    await flush();
  });

  it("makes every visible ledger query read again when the version moves", async () => {
    getStreamRefreshActionMock.mockResolvedValue({ ...unchanged, version: "8", changed: true });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.ledgerSync(), { ...unchanged, version: "7" });
    const stream = vi.fn().mockResolvedValue("stream");
    const stats = vi.fn().mockResolvedValue("stats");
    const settings = vi.fn().mockResolvedValue("settings");

    renderHook(
      () => {
        useLedgerSync();
        useQuery({
          queryKey: ["ledger", "source-documents", "stream", {}],
          queryFn: stream,
          staleTime: Infinity,
        });
        useQuery({
          queryKey: ["ledger", "enhanced-stats", {}],
          queryFn: stats,
          staleTime: Infinity,
        });
        useQuery({ queryKey: ["ledger", "settings"], queryFn: settings, staleTime: Infinity });
      },
      { wrapper }
    );
    await flush();
    expect(stream).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await flush();

    expect(getStreamRefreshActionMock).toHaveBeenCalledWith(
      { afterVersion: "7" },
      { signal: expect.any(AbortSignal) }
    );
    for (const read of [stream, stats, settings]) expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the new version when a visible query fails to read again", async () => {
    getStreamRefreshActionMock.mockResolvedValue({ ...unchanged, version: "8", changed: true });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.ledgerSync(), { ...unchanged, version: "7" });
    const stream = vi
      .fn()
      .mockResolvedValueOnce("stream")
      .mockRejectedValue(new Error("stream is down"));

    renderHook(
      () => {
        useLedgerSync();
        useQuery({
          queryKey: ["ledger", "source-documents", "stream", {}],
          queryFn: stream,
          staleTime: Infinity,
        });
      },
      { wrapper }
    );
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await flush();

    // The page shows its own failure; the driver moved on to the new version,
    // so the next poll does not invalidate everything again.
    expect(stream).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(queryKeys.ledgerSync())?.status).toBe("success");
    expect(queryClient.getQueryData(queryKeys.ledgerSync())).toMatchObject({ version: "8" });
  });

  it("leaves the ledger alone when nothing moved", async () => {
    getStreamRefreshActionMock.mockResolvedValue(unchanged);
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.ledgerSync(), unchanged);
    const stream = vi.fn().mockResolvedValue("stream");

    renderHook(
      () => {
        useLedgerSync();
        useQuery({ queryKey: ["ledger", "entries", {}], queryFn: stream, staleTime: Infinity });
      },
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await flush();

    expect(getStreamRefreshActionMock).toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
