import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AudioUtilityError,
  capturePcmWav,
  getAudioBrowserSupport,
  listAudioInputs,
  mapMediaError,
  requestAudioPermission,
  requestedCaptureConstraints,
} from "../index";

const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);
const originalSecureContext = Object.getOwnPropertyDescriptor(
  window,
  "isSecureContext",
);

function installMediaDevices(mediaDevices: Partial<MediaDevices>): void {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
}

afterEach(() => {
  if (originalMediaDevices === undefined) {
    Reflect.deleteProperty(navigator, "mediaDevices");
  } else {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  }
  if (originalSecureContext === undefined) {
    Reflect.deleteProperty(window, "isSecureContext");
  } else {
    Object.defineProperty(window, "isSecureContext", originalSecureContext);
  }
  vi.restoreAllMocks();
});

describe("device discovery and permission contracts", () => {
  it("keeps unavailable browser labels explicitly uncertain", async () => {
    installMediaDevices({
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: "audioinput", deviceId: "a", groupId: "group", label: "" },
        {
          kind: "audioinput",
          deviceId: "b",
          groupId: "group",
          label: "USB Mic",
        },
        {
          kind: "videoinput",
          deviceId: "camera",
          groupId: "video",
          label: "Camera",
        },
      ]),
    });

    const inputs = await listAudioInputs();
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      deviceId: "a",
      reportedLabel: "",
      displayLabel: "Audio input 1 · browser unnamed",
      labelAvailable: false,
    });
    expect(inputs[1]).toMatchObject({
      reportedLabel: "USB Mic",
      labelAvailable: true,
    });
  });

  it("requests the selected device conservatively and leaves actual settings to the track", async () => {
    const stream = { getAudioTracks: () => [{}] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    installMediaDevices({ getUserMedia });

    await expect(requestAudioPermission("selected-device")).resolves.toBe(
      stream,
    );
    expect(getUserMedia).toHaveBeenCalledWith({
      video: false,
      audio: {
        deviceId: { exact: "selected-device" },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48_000 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
    });
    expect(requestedCaptureConstraints()).toMatchObject({
      deviceId: null,
      sampleRate: 48_000,
    });
  });

  it("maps permission failures and reports browser capabilities without throwing", () => {
    const mapped = mapMediaError(new DOMException("denied", "NotAllowedError"));
    expect(mapped).toBeInstanceOf(AudioUtilityError);
    expect(mapped.code).toBe("permission-denied");
    expect(getAudioBrowserSupport()).toMatchObject({
      secureContext: true,
      getUserMedia: false,
      enumerateDevices: false,
    });
  });

  it("enforces the hard 20-second limit before touching browser audio APIs", async () => {
    await expect(
      capturePcmWav({ stream: {} as MediaStream, durationMs: 20_001 }),
    ).rejects.toMatchObject({ code: "invalid-duration" });
  });
});
