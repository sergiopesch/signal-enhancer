"use client";

import {
  Activity,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  Info,
  PlusCircle,
  SlidersHorizontal,
  Waves,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  InstrumentMetadata,
  InstrumentRegistration,
} from "./instrument-chrome";
import { SignalMark } from "./signal-mark";
import { SignalPlot, type PlotTrack, type PlotView } from "./signal-plot";
import { Transport } from "./transport";
import { ViewTabs } from "./view-switches";
import type { CaptureRecord, UpgradeEvent } from "./types";

const STAGES = [
  "Receiving capture",
  "Inspecting signal",
  "Detecting noise and compression",
  "Restoring detail",
  "Polishing dynamics",
  "Generating difference map",
  "Preparing report",
] as const;

type UpgradeStageProps = {
  source: CaptureRecord;
  enhanced: CaptureRecord | null;
  events: readonly UpgradeEvent[];
  state: "running" | "complete" | "failed";
  mode: "demo" | "live";
  playing: boolean;
  currentTime: number;
  error: string | undefined;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onCancel: () => void;
  onReset: () => void;
};

function findStageStatus(
  events: readonly UpgradeEvent[],
  stage: string,
  index: number,
) {
  const event = [...events].reverse().find((item) => item.stage === stage);
  if (event) return event.status;
  const latestKnown = Math.max(
    -1,
    ...events.map((item) =>
      STAGES.indexOf(item.stage as (typeof STAGES)[number]),
    ),
  );
  return index < latestKnown
    ? "complete"
    : index === latestKnown
      ? "active"
      : "future";
}

function diffSamples(a: readonly number[], b: readonly number[]) {
  const length = Math.min(a.length, b.length);
  return Array.from(
    { length },
    (_, index) => ((b[index] ?? 0) - (a[index] ?? 0)) * 0.8,
  );
}

function StageRail({ events }: Readonly<{ events: readonly UpgradeEvent[] }>) {
  return (
    <ol className="upgrade-stage-rail" aria-label="Upgrade progress">
      {STAGES.map((stage, index) => {
        const status = findStageStatus(events, stage, index);
        const detail = [...events]
          .reverse()
          .find((event) => event.stage === stage)?.detail;
        return (
          <li key={stage} data-state={status}>
            <span className="upgrade-node" aria-hidden="true">
              {status === "complete" ? (
                <CheckCircle2 size={21} />
              ) : status === "active" ? (
                <span className="active-ring" />
              ) : (
                <Circle size={21} />
              )}
            </span>
            <div>
              <span>{stage}</span>
              {detail && status === "active" ? <small>{detail}</small> : null}
            </div>
            {events.find((event) => event.stage === stage)?.timestamp ? (
              <time>
                {events.find((event) => event.stage === stage)?.timestamp}
              </time>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function UpgradeProgress({
  source,
  enhanced,
  events,
  mode,
  onCancel,
}: Readonly<
  Pick<
    UpgradeStageProps,
    "source" | "enhanced" | "events" | "mode" | "onCancel"
  >
>) {
  const currentIndex = Math.max(
    0,
    ...events.map((item) =>
      STAGES.indexOf(item.stage as (typeof STAGES)[number]),
    ),
  );
  const currentStage = STAGES[currentIndex] ?? STAGES[0];
  const previewSamples =
    enhanced?.waveform ??
    source.waveform.map((value) => Math.tanh(value * 1.18) * 0.88);

  return (
    <section
      className="stage stage-upgrade-progress"
      aria-labelledby="upgrade-title"
    >
      <aside className="upgrade-progress-rail">
        <h1 id="upgrade-title">Reshaping the signal.</h1>
        <p className="lede">
          {mode === "live"
            ? "We’re restoring detail while preserving the character of your capture."
            : "We’re applying a fixed browser DSP chain so you can inspect a transparent local preview."}
        </p>
        <StageRail events={events} />
        <div className="warming-note">
          <SignalMark compact />
          <div>
            <strong>
              {mode === "live"
                ? "Warming upgrade engine"
                : "Preparing local preview"}
            </strong>
            <span>
              {mode === "live"
                ? "This can take longer after a quiet period."
                : "No audio leaves this browser in demo mode."}
            </span>
          </div>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={onCancel}
        >
          Cancel upgrade
        </button>
      </aside>

      <div className="upgrade-progress-instrument">
        <InstrumentRegistration />
        <div className="progress-legend">
          <span>
            <i data-color="cyan" />
            DSP preview ready
          </span>
          <span>
            <i data-color="amber" />
            {mode === "live"
              ? "AI restoration in progress"
              : "Local DSP route in progress"}
          </span>
        </div>
        <div className="stage-gates" aria-hidden="true">
          {STAGES.map((stage, index) => (
            <span
              key={stage}
              data-state={
                index < currentIndex
                  ? "complete"
                  : index === currentIndex
                    ? "active"
                    : "future"
              }
            >
              <small>{stage}</small>
              <i>
                {index < currentIndex
                  ? "✓"
                  : index === currentIndex
                    ? "●"
                    : "○"}
              </i>
            </span>
          ))}
        </div>
        <SignalPlot
          tracks={[
            {
              id: "source",
              label: "Original",
              color: "cyan",
              samples: source.waveform,
            },
            {
              id: "preview",
              label: "Preview",
              color: "amber",
              samples: previewSamples,
            },
          ]}
          activeGate={(currentIndex + 0.5) / STAGES.length}
          ariaLabel={`Upgrade processing visualization. Current stage: ${currentStage}`}
        />
        <InstrumentMetadata
          label="Upgrade route evidence"
          items={[
            { label: "Source", value: "Input A" },
            {
              label: "Duration",
              value: `${(source.samples.length / source.sampleRate).toFixed(
                1,
              )} s`,
            },
            {
              label: "Sample rate",
              value: `${source.sampleRate / 1_000} kHz`,
            },
            {
              label: "Route",
              value:
                mode === "live"
                  ? "Protected worker · receipt on completion"
                  : "Local DSP · browser-v1",
            },
          ]}
        />
        <div
          className="active-stage-note"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <SlidersHorizontal size={20} />
          <div>
            <strong>{currentStage}</strong>
            <span>
              {events.at(-1)?.detail ??
                "Following the signal through the processing route."}
            </span>
          </div>
          <div className="activity-strip" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => (
              <i
                key={index}
                style={{ height: `${18 + ((index * 17) % 44)}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function UpgradeResult({
  source,
  enhanced,
  mode,
  playing,
  currentTime,
  onTogglePlayback,
  onSeek,
  onReset,
}: Readonly<
  Pick<
    UpgradeStageProps,
    | "source"
    | "enhanced"
    | "mode"
    | "playing"
    | "currentTime"
    | "onTogglePlayback"
    | "onSeek"
    | "onReset"
  >
>) {
  const [view, setView] = useState<PlotView>("waveform");
  const result = enhanced ?? source;
  const tracks = useMemo<PlotTrack[]>(
    () => [
      {
        id: "original",
        label: "Original",
        color: "cyan",
        samples: source.waveform,
        spectrum: source.spectrum,
      },
      {
        id: "enhanced",
        label: "Enhanced",
        color: "amber",
        samples: result.waveform,
        spectrum: result.spectrum,
      },
      {
        id: "difference",
        label: "Difference",
        color: "neutral",
        samples: diffSamples(source.waveform, result.waveform),
      },
    ],
    [result, source],
  );

  return (
    <section
      className="stage stage-upgrade-result"
      aria-labelledby="result-title"
    >
      <header className="result-heading">
        <div>
          <h1 id="result-title">
            {mode === "live"
              ? "The signal, brought forward."
              : "A local preview, made visible."}
          </h1>
          <p>
            {mode === "live"
              ? "The protected worker returned a result for direct comparison; its exact routing and versions remain in the backend receipt."
              : "Fixed filters and restrained dynamics shaped this browser-only preview; no AI model was used."}
          </p>
          <span>Enhanced from Input A · {source.deviceLabel}</span>
        </div>
        <button
          className="button button-secondary compare-button"
          type="button"
          onClick={onTogglePlayback}
        >
          <span className="compare-circles" aria-hidden="true">
            <i />
            <i />
          </span>
          Compare A/B
        </button>
        <ViewTabs view={view} onChange={setView} includeDifference />
      </header>

      <div className="result-layout">
        <div className="result-instrument">
          <InstrumentRegistration />
          <SignalPlot
            tracks={tracks}
            view={view === "difference" ? "waveform" : view}
            playhead={currentTime / 20}
            ariaLabel={`${view} comparison of the original Input A and ${mode === "live" ? "enhanced" : "local preview"} signal`}
          />
          <InstrumentMetadata
            label="Result evidence"
            items={[
              { label: "Source", value: "Input A" },
              {
                label: "Duration",
                value: `${(source.samples.length / source.sampleRate).toFixed(
                  1,
                )} s`,
              },
              {
                label: "Sample rate",
                value: `${source.sampleRate / 1_000} kHz`,
              },
              { label: "Comparison", value: "Loudness matched" },
              {
                label: "Pipeline",
                value: mode === "live" ? "Backend receipt" : "browser-v1",
              },
            ]}
          />
          <Transport
            playing={playing}
            currentTime={currentTime}
            onToggle={onTogglePlayback}
            onSeek={onSeek}
            label="original and enhanced comparison"
          />
        </div>

        <aside className="result-report">
          <div className="report-panel">
            <h2>What changed</h2>
            {mode === "live" ? (
              <ul>
                <li>
                  <Activity size={19} />
                  Protected worker route completed
                </li>
                <li>
                  <Waves size={19} />
                  Enhanced WAV receipt validated
                </li>
                <li>
                  <SlidersHorizontal size={19} />
                  Output path matched this processing attempt
                </li>
                <li>
                  <FileText size={19} />
                  Exact routing and versions recorded server-side
                </li>
              </ul>
            ) : (
              <ul>
                <li>
                  <Activity size={19} />
                  Fixed high-pass filter applied
                </li>
                <li>
                  <Waves size={19} />
                  Broad tonal balance adjusted
                </li>
                <li>
                  <SlidersHorizontal size={19} />
                  Peaks gently controlled
                </li>
                <li>
                  <FileText size={19} />
                  Output loudness matched for a fair comparison
                </li>
              </ul>
            )}
            <div className="report-section">
              <h3>
                Limitations <Info size={15} />
              </h3>
              <p>
                Restored detail is inferred. It may not reproduce information
                that was never captured.
              </p>
            </div>
            <div className="report-section processing-record">
              <h3>Processing record</h3>
              <dl>
                <div>
                  <dt>Signal analysis</dt>
                  <dd>Completed</dd>
                </div>
                <div>
                  <dt>Restoration route</dt>
                  <dd>
                    {mode === "live"
                      ? "Backend-reported receipt"
                      : "Local DSP preview"}
                  </dd>
                </div>
                <div>
                  <dt>DSP finish</dt>
                  <dd>{mode === "live" ? "Recorded" : "Transparency mode"}</dd>
                </div>
                <div>
                  <dt>Pipeline version</dt>
                  <dd>{mode === "live" ? "Backend receipt" : "browser-v1"}</dd>
                </div>
              </dl>
            </div>
          </div>
          <a
            className="button button-primary"
            href={result.url}
            download="signal-enhancer-input-a.wav"
          >
            <Download size={18} />
            Download {mode === "live" ? "enhanced" : "preview"} WAV
          </a>
          <button
            className="button button-secondary"
            type="button"
            onClick={onReset}
          >
            <PlusCircle size={18} />
            Start a new experiment
          </button>
          <p className="privacy-note">
            <Info size={16} />
            {mode === "live"
              ? "Cloud access expires after 24 hours."
              : "Audio stays in this tab and is released when you reset or close it."}
          </p>
        </aside>
      </div>
    </section>
  );
}

export function UpgradeStage(props: Readonly<UpgradeStageProps>) {
  if (props.state === "running") return <UpgradeProgress {...props} />;
  if (props.state === "failed") {
    return (
      <section className="fault-inline" role="alert">
        <p className="instrument-label">Upgrade unavailable</p>
        <h1>The deeper restoration did not finish.</h1>
        <p>
          {props.error ??
            "Your original capture and local DSP preview are still available in this browser."}
        </p>
        {props.enhanced ? (
          <a
            className="button button-primary"
            href={props.enhanced.url}
            download="signal-enhancer-local-preview.wav"
          >
            <Download size={18} />
            Download local DSP preview
          </a>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          onClick={props.onReset}
        >
          Start a new experiment
        </button>
      </section>
    );
  }
  return <UpgradeResult {...props} />;
}
