"use client";

import { ArrowRight, Info, Mic, Play, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  InstrumentMetadata,
  InstrumentRegistration,
} from "./instrument-chrome";
import { ModeSwitch, ViewTabs } from "./view-switches";
import { SignalPlot, type PlotTrack, type PlotView } from "./signal-plot";
import { Transport } from "./transport";
import type { CaptureRecord, Observation } from "./types";

type RevealStageProps = {
  captureA: CaptureRecord;
  captureB: CaptureRecord;
  observations: readonly Observation[];
  playing: boolean;
  currentTime: number;
  signalMode: "demo" | "live";
  onPlay: (mode: "A" | "B" | "both") => void;
  onSeek: (time: number) => void;
  onRepeat: () => void;
  onUpgrade: () => void;
};

function matchLevel(
  values: readonly number[],
  sourceRmsDb: number,
  targetRmsDb: number,
) {
  const gain = Math.pow(10, (targetRmsDb - sourceRmsDb) / 20);
  return values.map((value) => Math.max(-1, Math.min(1, value * gain)));
}

function difference(a: readonly number[], b: readonly number[]) {
  const length = Math.min(a.length, b.length);
  return Array.from(
    { length },
    (_, index) => ((a[index] ?? 0) - (b[index] ?? 0)) * 0.72,
  );
}

function ObservationGlyph({ kind }: Readonly<{ kind: Observation["kind"] }>) {
  if (kind === "noise") {
    return (
      <svg viewBox="0 0 74 28" aria-hidden="true">
        <path d="M2 19c4-10 7 1 11-8s7 6 12-2 8 11 13 1 8 7 13-2 8 8 12-1 8 4 9-2" />
        <line x1="1" x2="73" y1="23" y2="23" />
      </svg>
    );
  }
  if (kind === "dynamics") {
    return (
      <svg viewBox="0 0 74 28" aria-hidden="true">
        <path d="M1 22h9l2-17 4 19 4-11 5 9h9l2-8 4 8h9l2-13 4 13h18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 74 28" aria-hidden="true">
      <path d="M1 15c7-19 15-19 22 0s15 19 23 0 15-19 27 0" />
    </svg>
  );
}

export function RevealStage({
  captureA,
  captureB,
  observations,
  playing,
  currentTime,
  signalMode,
  onPlay,
  onSeek,
  onRepeat,
  onUpgrade,
}: Readonly<RevealStageProps>) {
  const [mode, setMode] = useState<"absolute" | "matched">("absolute");
  const [view, setView] = useState<PlotView>("waveform");

  const tracks = useMemo<PlotTrack[]>(() => {
    const targetRms = Math.max(captureA.metrics.rmsDb, captureB.metrics.rmsDb);
    const a =
      mode === "matched"
        ? matchLevel(captureA.waveform, captureA.metrics.rmsDb, targetRms)
        : captureA.waveform;
    const b =
      mode === "matched"
        ? matchLevel(captureB.waveform, captureB.metrics.rmsDb, targetRms)
        : captureB.waveform;
    return [
      {
        id: "a",
        label: "A",
        color: "cyan",
        samples: a,
        spectrum: captureA.spectrum,
      },
      {
        id: "b",
        label: "B",
        color: "amber",
        samples: b,
        spectrum: captureB.spectrum,
      },
      {
        id: "difference",
        label: "Diff",
        color: "neutral",
        samples: difference(a, b),
      },
    ];
  }, [captureA, captureB, mode]);

  return (
    <section className="stage stage-reveal" aria-labelledby="reveal-title">
      <header className="reveal-heading">
        <div>
          <h1 id="reveal-title">Same sound. Different ears.</h1>
          <p>
            Two input chains, held against the same reference. Explore what
            changed—not which one won.
          </p>
          <div className="mobile-device-key">
            <span>
              <i data-color="cyan" />A · {captureA.deviceLabel}
            </span>
            <span>
              <i data-color="amber" />B · {captureB.deviceLabel}
            </span>
          </div>
        </div>
        <ModeSwitch mode={mode} onChange={setMode} />
        <ViewTabs view={view} onChange={setView} />
      </header>

      <div className="reveal-layout">
        <aside className="reveal-rail">
          <div className="source-list">
            <div>
              <p>
                <strong>Input A</strong>
                <span> · {captureA.deviceLabel}</span>
              </p>
              <button
                className="button button-secondary source-play"
                type="button"
                onClick={() => onPlay("A")}
              >
                <Mic size={18} /> Play Input A <kbd>A</kbd>
              </button>
            </div>
            <div>
              <p>
                <strong>Input B</strong>
                <span> · {captureB.deviceLabel}</span>
              </p>
              <button
                className="button button-secondary source-play"
                type="button"
                onClick={() => onPlay("B")}
              >
                <Mic size={18} /> Play Input B <kbd>B</kbd>
              </button>
            </div>
            <div>
              <p>
                <strong>Synchronized playback</strong>
              </p>
              <span>Plays A and B together for direct comparison.</span>
              <button
                className="button button-secondary source-play"
                type="button"
                onClick={() => onPlay("both")}
              >
                <Play size={17} fill="currentColor" /> Play both{" "}
                <kbd>
                  <b>A</b> + <em>B</em>
                </kbd>
              </button>
            </div>
          </div>
          <div className="reveal-actions desktop-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onRepeat}
            >
              <RotateCcw size={18} />
              Repeat captures
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={onUpgrade}
            >
              Upgrade Signal
              <ArrowRight size={19} />
            </button>
            <p className="privacy-note">
              <Info size={16} />
              {signalMode === "live"
                ? "Cloud access expires after 24 hours."
                : "Audio stays in this tab and is released when you reset or close it."}
            </p>
          </div>
        </aside>

        <div className="comparison-instrument">
          <InstrumentRegistration />
          <div className="plot-legend" aria-label="Signal legend">
            <span>
              <i data-color="cyan" />
              Input A
            </span>
            <span>
              <i data-color="amber" />
              Input B
            </span>
            <span>
              <i data-color="neutral" />
              Difference
            </span>
          </div>
          <SignalPlot
            tracks={tracks}
            view={view === "difference" ? "waveform" : view}
            playhead={currentTime / 20}
            ariaLabel={`${mode === "absolute" ? "Absolute" : "Loudness-matched"} ${view} comparison of Input A, Input B, and their difference`}
          />
          <InstrumentMetadata
            label="Comparison evidence"
            items={[
              { label: "Reference", value: "diagnostic-speech-v1" },
              {
                label: "Duration",
                value: `${(
                  captureA.samples.length / captureA.sampleRate
                ).toFixed(1)} s`,
              },
              {
                label: "Sample rate",
                value: `${captureA.sampleRate / 1_000} kHz`,
              },
              {
                label: "View",
                value: mode === "absolute" ? "Absolute" : "Loudness matched",
              },
            ]}
          />
          <Transport
            playing={playing}
            currentTime={currentTime}
            onToggle={() => onPlay("both")}
            onSeek={onSeek}
            label="both captures"
          />
        </div>
      </div>

      <section
        className="observation-section"
        aria-labelledby="observations-title"
      >
        <p id="observations-title" className="instrument-label">
          What the signal suggests
        </p>
        <div className="observation-rail">
          {observations.map((observation) => (
            <article key={observation.title}>
              <ObservationGlyph kind={observation.kind} />
              <div>
                <h2>{observation.title}</h2>
                <p>{observation.detail}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="qualification">
          <Info size={16} />
          These patterns may reflect device processing, position, playback, or
          the room.
        </p>
      </section>

      <div className="reveal-actions mobile-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onUpgrade}
        >
          Upgrade Signal
          <ArrowRight size={19} />
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={onRepeat}
        >
          <RotateCcw size={18} />
          Repeat captures
        </button>
        <p className="privacy-note">
          <Info size={16} />
          {signalMode === "live"
            ? "Cloud access expires after 24 hours."
            : "Audio stays in this tab and is released when you reset or close it."}
        </p>
      </div>
    </section>
  );
}
