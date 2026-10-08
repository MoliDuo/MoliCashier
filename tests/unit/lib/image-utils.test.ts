import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressImage } from "@/lib/image-utils";

type WorkerListener = (event: MessageEvent | ErrorEvent) => void;

class TestWorker {
  static instances: TestWorker[] = [];
  static live = 0;
  static maxLive = 0;
  static autoComplete = true;

  private listeners = new Map<string, Set<WorkerListener>>();
  terminated = false;

  constructor() {
    TestWorker.instances.push(this);
    TestWorker.live += 1;
    TestWorker.maxLive = Math.max(TestWorker.maxLive, TestWorker.live);
  }

  addEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage() {
    if (!TestWorker.autoComplete) return;
    queueMicrotask(() => {
      const event = { data: { success: true, data: new ArrayBuffer(1) } } as MessageEvent;
      this.listeners.get("message")?.forEach((listener) => listener(event));
    });
  }

  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    TestWorker.live -= 1;
  }
}

beforeEach(() => {
  TestWorker.instances = [];
  TestWorker.live = 0;
  TestWorker.maxLive = 0;
  TestWorker.autoComplete = true;
  vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
  vi.stubGlobal("Worker", TestWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client image compression workers", () => {
  it("caps concurrency at three and terminates every completed worker", async () => {
    const files = Array.from(
      { length: 7 },
      (_, index) => new File([String(index)], `image-${index}.png`, { type: "image/png" })
    );

    await Promise.all(files.map((file) => compressImage(file)));

    expect(TestWorker.maxLive).toBe(3);
    expect(TestWorker.instances).toHaveLength(7);
    expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });

  it("terminates the worker when compression is aborted", async () => {
    TestWorker.autoComplete = false;
    const controller = new AbortController();
    const result = compressImage(
      new File(["image"], "image.png", { type: "image/png" }),
      undefined,
      0.8,
      controller.signal
    );

    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(TestWorker.instances[0]?.terminated).toBe(true);
  });
});
