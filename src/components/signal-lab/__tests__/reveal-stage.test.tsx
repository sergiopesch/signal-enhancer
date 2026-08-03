import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GUIDED_READING_DURATION_SECONDS,
  GUIDED_READING_ID,
} from "@/lib/audio/reading-passage";

import { RevealStage } from "../reveal-stage";
import type { CaptureRecord } from "../types";

afterEach(cleanup);

const SAMPLE_RATE = 8_000;

function makeSamples() {
  const samples = new Float32Array(
    SAMPLE_RATE * GUIDED_READING_DURATION_SECONDS,
  );
  samples.fill(0.12, SAMPLE_RATE * 2, SAMPLE_RATE * 8);
  samples.fill(0.03, SAMPLE_RATE * 8, SAMPLE_RATE * 14);
  samples.fill(0.12, SAMPLE_RATE * 14, SAMPLE_RATE * 20);
  return samples;
}

function capture(slot: "A" | "B"): CaptureRecord {
  return {
    slot,
    protocolId: GUIDED_READING_ID,
    blob: new Blob([], { type: "audio/wav" }),
    url: `blob:test-${slot.toLowerCase()}`,
    samples: makeSamples(),
    sampleRate: SAMPLE_RATE,
    waveform: [0, 0.12, -0.08, 0.1, -0.04, 0.03],
    spectrum: [-82, -61, -43, -55, -73],
    spectrumFrequenciesHz: [20, 100, 500, 1_000, 4_000],
    dynamics: [-120, -24, -25, -36, -24],
    metrics: {
      rmsDb: -23.1,
      peakDb: -18.4,
      noiseFloorDb: -72,
      dynamicRangeDb: 24,
      clippingPercent: 0,
      highFrequencyRatio: 0.08,
    },
    deviceLabel: slot === "A" ? "Studio input" : "Headset input",
  };
}

function setup() {
  const handlers = {
    onSelect: vi.fn(),
    onPlay: vi.fn(),
    onSeek: vi.fn(),
    onRepeat: vi.fn(),
    onUpgrade: vi.fn(),
  };
  const rendered = render(
    <RevealStage
      captureA={capture("A")}
      captureB={capture("B")}
      playing={false}
      activeTrack={null}
      currentTime={7}
      signalMode="demo"
      {...handlers}
    />,
  );
  return { ...rendered, handlers };
}

describe("RevealStage individual track review", () => {
  it("defaults to Input A and renders one evidence track per responsive plot", () => {
    const { container } = setup();
    const inputA = screen.getByRole("tab", { name: /Input A/ });
    const inputB = screen.getByRole("tab", { name: /Input B/ });

    expect(inputA.getAttribute("aria-selected")).toBe("true");
    expect(inputB.getAttribute("aria-selected")).toBe("false");
    expect(
      screen.getAllByRole("img", {
        name: "Input A waveform for the guided reading",
      }),
    ).toHaveLength(2);
    for (const plot of container.querySelectorAll(".signal-plot")) {
      expect(plot.querySelectorAll(".plot-track")).toHaveLength(1);
      expect(plot.textContent).toContain("Input A");
      expect(plot.textContent).not.toContain("Input B");
    }
  });

  it("selects Input B explicitly and sends B to the playback callback", () => {
    const { handlers } = setup();
    const inputB = screen.getByRole("tab", { name: /Input B/ });

    fireEvent.click(inputB);

    expect(handlers.onSelect).toHaveBeenCalledWith("B");
    expect(inputB.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getAllByRole("img", {
        name: "Input B waveform for the guided reading",
      }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Play Input B" }));
    expect(handlers.onPlay).toHaveBeenCalledWith("B");
  });

  it("contains no simultaneous or play-both control", () => {
    setup();

    expect(screen.queryByRole("button", { name: /play both/i })).toBeNull();
    expect(screen.queryByText(/synchronized playback/i)).toBeNull();
    expect(screen.queryByText(/A\s*\+\s*B/)).toBeNull();
  });

  it("seeks to the start of selected cue and ranged finding", () => {
    const { handlers } = setup();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Jump to Soft but clear, 0:08–0:14",
      }),
    );
    expect(handlers.onSeek).toHaveBeenLastCalledWith(8);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Jump to 0:02–0:14: The softer direction remains visible",
      }),
    );
    expect(handlers.onSeek).toHaveBeenLastCalledWith(2);
    expect(handlers.onSeek).toHaveBeenCalledTimes(2);
  });

  it("switches Spectrum and Dynamics to their correct evidence labels", () => {
    const { container } = setup();

    fireEvent.click(screen.getByRole("tab", { name: "Spectrum" }));
    expect(
      screen.getByText("Magnitude · −120 to 0 dBFS · logarithmic frequency"),
    ).not.toBeNull();
    expect(
      screen.getAllByRole("img", {
        name: "Input A spectrum for the guided reading",
      }),
    ).toHaveLength(2);
    expect(container.querySelectorAll(".playhead")).toHaveLength(0);
    const spectrumRulers = Array.from(
      container.querySelectorAll<SVGGElement>(".signal-plot .plot-ruler"),
      (element) => element.textContent ?? "",
    );
    expect(spectrumRulers.every((label) => label.includes("Hz"))).toBe(true);
    expect(spectrumRulers.every((label) => !label.includes("0:20"))).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Dynamics" }));
    expect(
      screen.getByText("RMS envelope · −120 to 0 dBFS · time in seconds"),
    ).not.toBeNull();
    expect(
      screen.getAllByRole("img", {
        name: "Input A dynamics for the guided reading",
      }),
    ).toHaveLength(2);
    expect(container.querySelectorAll(".playhead")).toHaveLength(2);
    expect(screen.queryByText(/No dynamics evidence available/)).toBeNull();
  });
});
