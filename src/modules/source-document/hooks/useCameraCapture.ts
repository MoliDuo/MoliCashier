"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Longest edge of a captured frame. The upload pipeline downscales to 1080 anyway. */
const MAX_CAPTURE_EDGE = 1600;
const CAPTURE_QUALITY = 0.92;
/** How many rear cameras to open while hunting for one that can autofocus. */
const MAX_REAR_PROBES = 4;
const CONTINUOUS = "continuous";
/** Chrome labels Android cameras "camera2 0, facing back"; iOS says "Back Camera". */
const REAR_CAMERA_LABEL = /back|rear|后/iu;

export type CameraStatus =
  "idle" | "starting" | "ready" | "unavailable" | "unsupported" | "insecure";

type FacingMode = "environment" | "user";

/**
 * `focusMode` comes from the Media Capture Image extensions, which the DOM types
 * do not carry: capabilities list the modes a camera offers, while settings
 * report the one it is in.
 */
type FocusCapabilities = { focusMode?: string[] };
type FocusSettings = { focusMode?: string };
type CameraCapabilities = MediaTrackCapabilities & FocusCapabilities;

interface UseCameraCaptureOptions {
  /** False stops the stream: the form is hidden, collapsed, or submitting. */
  enabled: boolean;
  onCapture: (file: File) => void;
}

export interface CameraCapture {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** `unsupported` means no camera API at all — the caller should show nothing. */
  status: CameraStatus;
  /** True once the device reports more than one camera, so switching means something. */
  canSwitch: boolean;
  isMirrored: boolean;
  capture: () => void;
  switchFacing: () => void;
  retry: () => void;
}

/**
 * What this camera can do, or null when the browser will not say — either it has
 * no capability API at all, or it answered with nothing. An answered-but-empty
 * list is a different thing from a refusal, and only the former is worth acting
 * on: a browser that never answers would otherwise have us opening cameras for
 * nothing.
 */
function readCapabilities(track: MediaStreamTrack): CameraCapabilities | null {
  if (typeof track.getCapabilities !== "function") return null;
  try {
    const capabilities = track.getCapabilities() as CameraCapabilities;
    return capabilities != null && Object.keys(capabilities).length > 0 ? capabilities : null;
  } catch {
    return null;
  }
}

function focusModesOf(track: MediaStreamTrack): string[] | null {
  return readCapabilities(track)?.focusMode ?? null;
}

function focusSettingOf(track: MediaStreamTrack): string | undefined {
  if (typeof track.getSettings !== "function") return undefined;
  return (track.getSettings() as MediaTrackSettings & FocusSettings).focusMode;
}

function cameraConstraints(facing: FacingMode, deviceId: string | null): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
  // A pinned deviceId outranks facingMode, so it is only ever used for the rear
  // camera — with it in place, switching to the front would still find the rear.
  if (facing === "environment" && deviceId != null) video.deviceId = { ideal: deviceId };
  else video.facingMode = { ideal: facing };
  return { video };
}

/**
 * Opens one camera just long enough to ask what it can do. `null` means it would
 * not answer at all, which is not the same as answering without a focus mode.
 */
async function probeCapabilities(deviceId: string): Promise<CameraCapabilities | null> {
  let probe: MediaStream | null = null;
  try {
    probe = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
    const track = probe.getVideoTracks()[0];
    return track == null ? null : readCapabilities(track);
  } catch {
    return null;
  } finally {
    probe?.getTracks().forEach((track) => track.stop());
  }
}

/**
 * A rear camera that says it can autofocus, or null when none of them says so.
 *
 * A phone with several rear lenses can be made to hand us one that is fixed at
 * infinity: far things sharp, close things blurry, which is useless for a
 * receipt held at arm's length. Which lens we get is the browser's choice, not
 * ours, so asking each one what it offers is the only way to have a say.
 */
async function findAutofocusRearCamera(
  currentDeviceId: string | undefined
): Promise<string | null> {
  if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return null;

  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return null;
  }

  const candidates = devices
    .filter(
      (device) =>
        device.kind === "videoinput" &&
        device.deviceId !== currentDeviceId &&
        REAR_CAMERA_LABEL.test(device.label)
    )
    .slice(0, MAX_REAR_PROBES);

  for (const candidate of candidates) {
    // A lens that will not open, or that has nothing to say, is no reason to
    // stop: auxiliary rear lenses refuse to open on some phones while the one
    // that can focus sits next in the list.
    const capabilities = await probeCapabilities(candidate.deviceId);
    if (capabilities?.focusMode?.includes(CONTINUOUS) === true) return candidate.deviceId;
  }
  return null;
}

/** Asks a camera that can autofocus to keep doing it. */
async function requestContinuousFocus(track: MediaStreamTrack): Promise<void> {
  if (focusModesOf(track)?.includes(CONTINUOUS) !== true) return;
  if (focusSettingOf(track) === CONTINUOUS) return;

  try {
    const advanced = [{ focusMode: CONTINUOUS }] as unknown as MediaTrackConstraintSet[];
    await track.applyConstraints({ advanced });
  } catch {
    // A refused constraint leaves the camera doing whatever it already did.
  }
}

export function useCameraCapture({ enabled, onCapture }: UseCameraCaptureOptions): CameraCapture {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const preferredDeviceIdRef = useRef<string | null>(null);
  const hasPickedRearRef = useRef(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [canSwitch, setCanSwitch] = useState(false);
  const [facing, setFacing] = useState<FacingMode>("environment");
  const [retryToken, setRetryToken] = useState(0);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);

  useEffect(() => {
    const update = () => setIsDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const stopStream = useCallback(() => {
    generationRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current != null) videoRef.current.srcObject = null;
  }, []);

  const shouldRun = enabled && isDocumentVisible;

  useEffect(() => {
    if (!shouldRun) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const isCurrent = () => generationRef.current === generation;
    const release = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

    const start = async () => {
      if (navigator.mediaDevices?.getUserMedia == null) {
        // Browsers only expose the camera on a secure context, so a phone
        // opened over a plain-HTTP address lands here rather than failing.
        setStatus(window.isSecureContext ? "unsupported" : "insecure");
        return;
      }
      setStatus("starting");

      const acquire = async (deviceId: string | null) => {
        try {
          return await navigator.mediaDevices.getUserMedia(cameraConstraints(facing, deviceId));
        } catch (error) {
          if (deviceId == null) throw error;
          return navigator.mediaDevices.getUserMedia(cameraConstraints(facing, null));
        }
      };

      let stream: MediaStream;
      try {
        stream = await acquire(preferredDeviceIdRef.current);
      } catch {
        if (!isCurrent()) return;
        setStatus("unavailable");
        return;
      }

      if (!isCurrent()) {
        release(stream);
        return;
      }

      const track = stream.getVideoTracks()[0];
      const capabilities = track == null ? null : readCapabilities(track);
      if (facing === "environment" && !hasPickedRearRef.current && track != null) {
        hasPickedRearRef.current = true;
        if (capabilities?.focusMode?.includes(CONTINUOUS) === true) {
          await requestContinuousFocus(track);
          // The dialog may have closed while the lens answered; nothing else
          // holds this stream, so it is released here or never.
          if (!isCurrent()) {
            release(stream);
            return;
          }
        } else if (capabilities != null) {
          // The browser answered and this lens says it cannot focus, so every
          // other rear camera is worth a look. If it would not answer at all,
          // keep the camera we were handed and leave it alone.
          // Hand the camera back before probing: some devices refuse a second
          // one while the first is still streaming.
          const currentDeviceId = track.getSettings().deviceId;
          release(stream);
          const picked = await findAutofocusRearCamera(currentDeviceId);
          if (!isCurrent()) return;
          if (picked != null) preferredDeviceIdRef.current = picked;
          try {
            stream = await acquire(picked);
          } catch {
            if (!isCurrent()) return;
            setStatus("unavailable");
            return;
          }
          if (!isCurrent()) {
            release(stream);
            return;
          }
        }
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video != null) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      if (!isCurrent()) {
        // A newer run owns the camera now; drop this one if it is still attached.
        release(stream);
        if (streamRef.current === stream) streamRef.current = null;
        if (video != null && video.srcObject === stream) video.srcObject = null;
        return;
      }
      setStatus("ready");

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (isCurrent()) {
          setCanSwitch(devices.filter((device) => device.kind === "videoinput").length > 1);
        }
      } catch {
        if (isCurrent()) setCanSwitch(false);
      }
    };

    void start();
    return stopStream;
  }, [shouldRun, facing, retryToken, stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (video == null || video.videoWidth === 0 || video.videoHeight === 0) return;

    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context == null) return;
    context.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (blob == null) return;
        onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      CAPTURE_QUALITY
    );
  }, [onCapture]);

  const switchFacing = useCallback(() => {
    setFacing((current) => (current === "environment" ? "user" : "environment"));
  }, []);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  return {
    videoRef,
    status,
    canSwitch,
    isMirrored: facing === "user",
    capture,
    switchFacing,
    retry,
  };
}
