import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCameraCapture } from "@/modules/source-document/hooks/useCameraCapture";

interface FakeCameraOptions {
  deviceId?: string;
  /** `[]` means the camera reports no usable focus mode — a fixed-focus lens. */
  focusModes?: string[];
  focusSetting?: string;
  /** False models a browser whose capability API answers with nothing. */
  reportsCapabilities?: boolean;
}

function fakeCamera(options: FakeCameraOptions = {}) {
  const focusModes = options.focusModes ?? ["continuous"];
  const stop = vi.fn();
  const applyConstraints = vi.fn().mockResolvedValue(undefined);
  const track = {
    stop,
    applyConstraints,
    getSettings: () => ({
      deviceId: options.deviceId ?? "rear-0",
      ...(options.focusSetting == null ? {} : { focusMode: options.focusSetting }),
    }),
    getCapabilities: () => (options.reportsCapabilities === false ? {} : { focusMode: focusModes }),
  };
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
    track,
    stop,
    applyConstraints,
  };
}

function stubMediaDevices(options: {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  devices?: Array<{ deviceId: string; label: string }>;
}) {
  const devices = options.devices ?? [{ deviceId: "rear-0", label: "camera2 0, facing back" }];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: options.getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue(
        devices.map((device) => ({
          kind: "videoinput",
          groupId: "group-1",
          toJSON: () => device,
          ...device,
        }))
      ),
    },
  });
}

function videoOf(call: MediaStreamConstraints["video"]): MediaTrackConstraints {
  return (call ?? {}) as MediaTrackConstraints;
}

/** `deviceId` is either a bare string or an `{ exact }` / `{ ideal }` bag. */
function deviceIdOf(video: MediaTrackConstraints): { exact?: string; ideal?: string } {
  const value = video.deviceId;
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  return value as { exact?: string; ideal?: string };
}

/** `facingMode` is either a bare string or an `{ exact }` / `{ ideal }` bag. */
function facingOf(video: MediaTrackConstraints): string | undefined {
  const value = video.facingMode;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value == null || Array.isArray(value)) return undefined;
  const bag = value as { exact?: string; ideal?: string };
  return bag.ideal ?? bag.exact;
}

function renderCamera(enabled: boolean) {
  return renderHook(
    ({ isEnabled }) => useCameraCapture({ enabled: isEnabled, onCapture: vi.fn() }),
    { initialProps: { isEnabled: enabled } }
  );
}

async function withSecureContext(value: boolean, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
  try {
    await run();
  } finally {
    if (original != null) Object.defineProperty(window, "isSecureContext", original);
    else Reflect.deleteProperty(window, "isSecureContext");
  }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("useCameraCapture", () => {
  it("leaves the camera alone until it is enabled", () => {
    const getUserMedia = vi.fn();
    stubMediaDevices({ getUserMedia });

    const { result } = renderCamera(false);

    expect(result.current.status).toBe("idle");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reports a browser without a camera API instead of throwing", async () => {
    // jsdom itself is not a secure context, so ask for one to isolate the case.
    await withSecureContext(true, async () => {
      const { result } = renderCamera(true);

      await waitFor(() => expect(result.current.status).toBe("unsupported"));
    });
  });

  it("blames the address, not the browser, on a page outside a secure context", async () => {
    await withSecureContext(false, async () => {
      const { result } = renderCamera(true);

      await waitFor(() => expect(result.current.status).toBe("insecure"));
    });
  });

  it("reports a refusal instead of leaving a dead viewfinder", async () => {
    stubMediaDevices({
      getUserMedia: async () => {
        throw new Error("NotAllowedError");
      },
    });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("tries again after a refusal when asked", async () => {
    const { stream } = fakeCamera({ focusModes: ["continuous"] });
    let attempts = 0;
    stubMediaDevices({
      getUserMedia: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("NotAllowedError");
        return stream;
      },
    });

    const { result } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("unavailable"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("opens the rear camera and switches to the front on request", async () => {
    const { stream, stop } = fakeCamera({ focusModes: ["continuous"] });
    const constraints: MediaStreamConstraints[] = [];
    stubMediaDevices({
      getUserMedia: async (next) => {
        constraints.push(next);
        return stream;
      },
      devices: [
        { deviceId: "rear-0", label: "camera2 0, facing back" },
        { deviceId: "front-0", label: "camera 1, facing front" },
      ],
    });

    const { result } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(videoOf(constraints[0]?.video).facingMode).toEqual({ ideal: "environment" });
    await waitFor(() => expect(result.current.canSwitch).toBe(true));
    expect(result.current.isMirrored).toBe(false);

    act(() => result.current.switchFacing());

    await waitFor(() => expect(constraints).toHaveLength(2));
    expect(videoOf(constraints[1]?.video).facingMode).toEqual({ ideal: "user" });
    expect(result.current.isMirrored).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("hides the switch on a device with one camera", async () => {
    stubMediaDevices({ getUserMedia: async () => fakeCamera().stream });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.canSwitch).toBe(false);
  });

  it("releases the camera when it stops being enabled", async () => {
    const { stream, stop } = fakeCamera();
    stubMediaDevices({ getUserMedia: async () => stream });

    const { result, rerender } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ isEnabled: false });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases the camera on unmount", async () => {
    const { stream, stop } = fakeCamera();
    stubMediaDevices({ getUserMedia: async () => stream });

    const { result, unmount } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("releases a camera that finished focusing after the viewfinder closed", async () => {
    const camera = fakeCamera({ focusModes: ["continuous"], focusSetting: "single-shot" });
    let finishFocus: () => void = () => {};
    camera.applyConstraints.mockImplementation(
      () => new Promise<void>((resolve) => (finishFocus = resolve))
    );
    stubMediaDevices({ getUserMedia: async () => camera.stream });

    const { result, unmount } = renderCamera(true);
    await waitFor(() => expect(camera.applyConstraints).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => finishFocus());

    expect(camera.stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("starting");
  });
});

describe("useCameraCapture rear camera choice", () => {
  it("keeps the camera it holds when that one can autofocus", async () => {
    const camera = fakeCamera({ focusModes: ["continuous"], focusSetting: "single-shot" });
    const getUserMedia = vi.fn(async () => camera.stream);
    stubMediaDevices({ getUserMedia });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(camera.applyConstraints).toHaveBeenCalledTimes(1));
    // Nothing to shop for, so the camera is opened exactly once.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("swaps in a rear camera that can autofocus when the first one cannot", async () => {
    const fixed = fakeCamera({ deviceId: "rear-fixed", focusModes: [] });
    const probe = fakeCamera({ deviceId: "rear-main", focusModes: ["continuous"] });
    const chosen = fakeCamera({ deviceId: "rear-main", focusModes: ["continuous"] });
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const video = videoOf(constraints.video);
      const { exact, ideal } = deviceIdOf(video);
      if (exact === "rear-main") return probe.stream;
      if (ideal === "rear-main") return chosen.stream;
      return fixed.stream;
    });
    stubMediaDevices({
      getUserMedia,
      devices: [
        { deviceId: "rear-fixed", label: "camera2 2, facing back" },
        { deviceId: "rear-main", label: "camera2 0, facing back" },
      ],
    });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const last = videoOf(getUserMedia.mock.calls.at(-1)?.[0].video);
    expect(last.deviceId).toEqual({ ideal: "rear-main" });
    // The lens that cannot focus is handed back before the others are opened.
    expect(fixed.stop).toHaveBeenCalled();
  });

  it("keeps the camera it holds when no rear camera reports autofocus", async () => {
    const fixed = fakeCamera({ deviceId: "rear-fixed", focusModes: [] });
    const other = fakeCamera({ deviceId: "rear-other", focusModes: [] });
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (deviceIdOf(videoOf(constraints.video)).exact === "rear-other") return other.stream;
      return fixed.stream;
    });
    stubMediaDevices({
      getUserMedia,
      devices: [
        { deviceId: "rear-fixed", label: "camera2 2, facing back" },
        { deviceId: "rear-other", label: "camera2 0, facing back" },
      ],
    });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const last = videoOf(getUserMedia.mock.calls.at(-1)?.[0].video);
    expect(last.deviceId).toBeUndefined();
    expect(last.facingMode).toEqual({ ideal: "environment" });
  });

  it("keeps looking when one rear camera refuses to open", async () => {
    const fixed = fakeCamera({ deviceId: "rear-fixed", focusModes: [] });
    const chosen = fakeCamera({ deviceId: "rear-main", focusModes: ["continuous"] });
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const { exact, ideal } = deviceIdOf(videoOf(constraints.video));
      if (exact === "rear-blocked" || ideal === "rear-blocked") throw new Error("NotReadableError");
      if (exact === "rear-main" || ideal === "rear-main") return chosen.stream;
      return fixed.stream;
    });
    stubMediaDevices({
      getUserMedia,
      devices: [
        { deviceId: "rear-blocked", label: "camera2 4, facing back" },
        { deviceId: "rear-main", label: "camera2 0, facing back" },
      ],
    });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(deviceIdOf(videoOf(getUserMedia.mock.calls.at(-1)?.[0].video)).ideal).toBe("rear-main");
  });

  it("leaves the camera alone when the browser will not describe it", async () => {
    const camera = fakeCamera({ reportsCapabilities: false });
    const getUserMedia = vi.fn(async () => camera.stream);
    stubMediaDevices({
      getUserMedia,
      devices: [
        { deviceId: "rear-0", label: "camera2 0, facing back" },
        { deviceId: "rear-other", label: "camera2 2, facing back" },
      ],
    });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    // Nothing to learn, so nothing is opened or asked.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(camera.applyConstraints).not.toHaveBeenCalled();
  });

  it("never pins a rear camera onto the front camera", async () => {
    const fixed = fakeCamera({ deviceId: "rear-fixed", focusModes: [] });
    const probe = fakeCamera({ deviceId: "rear-main", focusModes: ["continuous"] });
    const front = fakeCamera({ deviceId: "front-0", focusModes: ["continuous"] });
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const video = videoOf(constraints.video);
      if (facingOf(video) === "user") return front.stream;
      if (deviceIdOf(video).exact === "rear-main") return probe.stream;
      return fixed.stream;
    });
    stubMediaDevices({
      getUserMedia,
      devices: [
        { deviceId: "rear-fixed", label: "camera2 2, facing back" },
        { deviceId: "rear-main", label: "camera2 0, facing back" },
        { deviceId: "front-0", label: "camera 1, facing front" },
      ],
    });

    const { result } = renderCamera(true);
    await waitFor(() =>
      expect(videoOf(getUserMedia.mock.calls.at(-1)?.[0].video).deviceId).toEqual({
        ideal: "rear-main",
      })
    );

    act(() => result.current.switchFacing());

    await waitFor(() => expect(result.current.isMirrored).toBe(true));
    const last = videoOf(getUserMedia.mock.calls.at(-1)?.[0].video);
    expect(last.deviceId).toBeUndefined();
    expect(last.facingMode).toEqual({ ideal: "user" });
  });
});
