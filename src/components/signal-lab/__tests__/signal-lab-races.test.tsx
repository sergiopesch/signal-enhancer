import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  analyzeAudio: vi.fn(),
  capturePcmWav: vi.fn(),
  createDspPreview: vi.fn(),
  encodeWav: vi.fn(),
  listAudioInputs: vi.fn(),
  requestAudioPermission: vi.fn(),
  stopMediaStream: vi.fn(),
}));

vi.mock("@/lib/audio", () => audioMocks);

import { SignalLab } from "../signal-lab";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

class FakeAudioContext {
  readonly sampleRate = 48_000;
  readonly state: AudioContextState = "running";
  readonly currentTime = 0;

  close() {
    return Promise.resolve();
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  audioMocks.listAudioInputs.mockResolvedValue([
    { deviceId: "input-a", displayLabel: "Studio input" },
    { deviceId: "input-b", displayLabel: "Headset input" },
  ]);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ sessionId: "123e4567-e89b-42d3-a456-426614174000" }),
    ),
  );
});

async function enterInputACapture() {
  render(<SignalLab />);

  const confirmations = await screen.findAllByRole("button", {
    name: "Confirm device",
  });
  for (const confirmation of confirmations) {
    await waitFor(() =>
      expect((confirmation as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirmation);
  }
  const begin = screen.getByRole("button", { name: "Begin Input A" });
  await waitFor(() =>
    expect((begin as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(begin);

  await screen.findByRole("heading", {
    name: "Read one measured passage.",
    level: 1,
  });
}

describe("SignalLab async operation ownership", () => {
  it("does not let a cancelled permission request stop the replacement capture stream", async () => {
    const firstPermission = deferred<MediaStream>();
    const secondPermission = deferred<MediaStream>();
    const staleStream = { id: "stale-stream" } as MediaStream;
    const currentStream = { id: "current-stream" } as MediaStream;
    audioMocks.requestAudioPermission
      .mockReturnValueOnce(firstPermission.promise)
      .mockReturnValueOnce(secondPermission.promise);

    await enterInputACapture();
    fireEvent.click(
      screen.getByRole("button", { name: "Start three-second count-in" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop capture" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start three-second count-in",
      }),
    );

    expect(audioMocks.requestAudioPermission).toHaveBeenCalledTimes(2);
    secondPermission.resolve(currentStream);
    await screen.findByText("Recording begins in 3");
    firstPermission.resolve(staleStream);

    await waitFor(() =>
      expect(audioMocks.stopMediaStream).toHaveBeenCalledWith(staleStream),
    );
    expect(audioMocks.stopMediaStream).not.toHaveBeenCalledWith(currentStream);
  });

  it("does not let a cancelled audio-context resume restore a stale countdown", async () => {
    const firstResume = deferred<void>();
    const secondResume = deferred<void>();
    const resume = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstResume.promise)
      .mockReturnValueOnce(secondResume.promise);
    class SuspendedAudioContext extends FakeAudioContext {
      override readonly state = "suspended";

      resume() {
        return resume();
      }
    }
    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    audioMocks.requestAudioPermission
      .mockResolvedValueOnce({ id: "first-stream" } as MediaStream)
      .mockResolvedValueOnce({ id: "second-stream" } as MediaStream);

    await enterInputACapture();
    fireEvent.click(
      screen.getByRole("button", { name: "Start three-second count-in" }),
    );
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop capture" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Start three-second count-in" }),
    );
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));

    secondResume.resolve();
    await screen.findByText("Recording begins in 3");
    fireEvent.click(screen.getByRole("button", { name: "Stop capture" }));
    firstResume.resolve();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start three-second count-in" }),
      ).not.toBeNull(),
    );
    expect(screen.queryByText("Recording begins in 3")).toBeNull();
  });
});
