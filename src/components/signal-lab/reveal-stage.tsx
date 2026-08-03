"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Info,
  RotateCcw,
  ScanLine,
} from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  GUIDED_READING_CUES,
  GUIDED_READING_DURATION_SECONDS,
  GUIDED_READING_ID,
} from "@/lib/audio/reading-passage";
import {
  assessIndividualTrack,
  type IndividualTrackAssessment,
  type TrackInsight,
  type TrackInsightTone,
} from "@/lib/audio/track-assessment";

import {
  InstrumentMetadata,
  InstrumentRegistration,
} from "./instrument-chrome";
import {
  SignalPlot,
  type PlotSegment,
  type PlotTrack,
  type PlotView,
} from "./signal-plot";
import { Transport } from "./transport";
import type { CaptureRecord } from "./types";
import { ViewTabs } from "./view-switches";

type TrackSlot = "A" | "B";

type RevealStageProps = {
  captureA: CaptureRecord;
  captureB: CaptureRecord;
  playing: boolean;
  activeTrack: TrackSlot | null;
  currentTime: number;
  signalMode: "demo" | "live";
  onSelect: (slot: TrackSlot) => void;
  onPlay: (slot: TrackSlot) => void;
  onSeek: (time: number) => void;
  onRepeat: () => void;
  onUpgrade: () => void;
};

const TRACK_SLOTS: readonly TrackSlot[] = ["A", "B"];

const READING_SEGMENTS: readonly PlotSegment[] = GUIDED_READING_CUES.map(
  (cue) => ({
    label: cue.label,
    mobileLabel:
      cue.id === "room-tone" ? "Room" : (cue.label.split(" ")[0] ?? cue.label),
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
  }),
);

function formatDb(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "Not measured";
}

function formatTime(seconds: number) {
  const bounded = Math.max(0, Math.min(99, seconds));
  return `0:${Math.round(bounded).toString().padStart(2, "0")}`;
}

function formatRange(startSeconds: number, endSeconds: number) {
  return `${formatTime(startSeconds)}–${formatTime(endSeconds)}`;
}

function toneHeading(tone: TrackInsightTone) {
  if (tone === "strength") return "What held up";
  if (tone === "attention") return "Worth inspecting";
  return "Measured context";
}

function InsightGroup({
  tone,
  insights,
  onSeek,
}: Readonly<{
  tone: TrackInsightTone;
  insights: readonly TrackInsight[];
  onSeek: (seconds: number) => void;
}>) {
  const Icon =
    tone === "strength"
      ? CheckCircle2
      : tone === "attention"
        ? CircleAlert
        : Info;
  return (
    <section className="track-insight-group" data-tone={tone}>
      <header>
        <Icon size={18} aria-hidden="true" />
        <h2>{toneHeading(tone)}</h2>
        <span>{insights.length}</span>
      </header>
      {insights.length > 0 ? (
        <div className="track-insight-list">
          {insights.map((insight) => (
            <button
              type="button"
              className="track-insight"
              key={insight.id}
              onClick={() => onSeek(insight.startSeconds)}
              aria-label={`Jump to ${formatRange(insight.startSeconds, insight.endSeconds)}: ${insight.title}`}
            >
              <span className="track-insight-range">
                {formatRange(insight.startSeconds, insight.endSeconds)}
              </span>
              <span className="track-insight-copy">
                <strong>{insight.title}</strong>
                <span>{insight.detail}</span>
              </span>
              <span className="track-insight-value">
                {insight.measuredValue}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="track-insight-empty">
          No measured item crossed this review threshold.
        </p>
      )}
    </section>
  );
}

function TrackMetrics({
  capture,
  assessment,
}: Readonly<{
  capture: CaptureRecord;
  assessment: IndividualTrackAssessment;
}>) {
  const roomTone = assessment.cues.find((cue) => cue.cueId === "room-tone");
  return (
    <dl className="track-metrics" aria-label={`Input ${capture.slot} metrics`}>
      <div>
        <dt>Whole-capture RMS</dt>
        <dd>{formatDb(capture.metrics.rmsDb)}</dd>
      </div>
      <div>
        <dt>Highest sample</dt>
        <dd>{formatDb(capture.metrics.peakDb)}</dd>
      </div>
      <div>
        <dt>Opening room tone</dt>
        <dd>{formatDb(roomTone?.rmsDbFs ?? Number.NaN)}</dd>
      </div>
      <div>
        <dt>Dynamic-range proxy</dt>
        <dd>{capture.metrics.dynamicRangeDb.toFixed(1)} dB</dd>
      </div>
    </dl>
  );
}

export function RevealStage({
  captureA,
  captureB,
  playing,
  activeTrack,
  currentTime,
  signalMode,
  onSelect,
  onPlay,
  onSeek,
  onRepeat,
  onUpgrade,
}: Readonly<RevealStageProps>) {
  const [selectedSlot, setSelectedSlot] = useState<TrackSlot>("A");
  const [view, setView] = useState<PlotView>("waveform");
  const generatedId = useId().replace(/:/g, "");
  const panelId = `track-review-${generatedId}`;
  const trackTabRefs = useRef(new Map<TrackSlot, HTMLButtonElement>());
  const captures = useMemo(
    () => ({ A: captureA, B: captureB }),
    [captureA, captureB],
  );
  const assessments = useMemo(
    () => ({
      A: assessIndividualTrack(captureA.samples, captureA.sampleRate, "A"),
      B: assessIndividualTrack(captureB.samples, captureB.sampleRate, "B"),
    }),
    [captureA, captureB],
  );
  const capture = captures[selectedSlot];
  const assessment = assessments[selectedSlot];
  const selectedPlaying = playing && activeTrack === selectedSlot;
  const plotTracks = useMemo<readonly PlotTrack[]>(
    () => [
      {
        id: `capture-${selectedSlot.toLowerCase()}`,
        label: `Input ${selectedSlot}`,
        color: selectedSlot === "A" ? "cyan" : "amber",
        samples: capture.waveform,
        spectrum: capture.spectrum,
        spectrumFrequenciesHz: capture.spectrumFrequenciesHz,
        dynamics: capture.dynamics,
      },
    ],
    [capture, selectedSlot],
  );

  const selectTrack = (slot: TrackSlot) => {
    if (slot === selectedSlot) return;
    onSelect(slot);
    setSelectedSlot(slot);
  };

  const handleTrackKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % TRACK_SLOTS.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + TRACK_SLOTS.length) % TRACK_SLOTS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TRACK_SLOTS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextSlot = TRACK_SLOTS[nextIndex];
    if (!nextSlot) return;
    selectTrack(nextSlot);
    trackTabRefs.current.get(nextSlot)?.focus();
  };

  const insightsFor = (tone: TrackInsightTone) =>
    assessment.insights.filter((insight) => insight.tone === tone);

  return (
    <section
      className="stage stage-reveal track-review"
      aria-labelledby="reveal-title"
    >
      <header className="track-review-heading">
        <div>
          <p className="instrument-label">Individual capture review</p>
          <h1 id="reveal-title" tabIndex={-1}>
            One input under the lens.
          </h1>
          <p>
            Inspect each recording on its own timeline. Switching inputs stops
            the current playback, so the two recordings never play together.
          </p>
        </div>
        <div className="track-review-protocol">
          <ScanLine size={18} aria-hidden="true" />
          <span>
            Same script · two separate passes
            <small>{GUIDED_READING_ID}</small>
          </span>
        </div>
      </header>

      <div
        className="track-selector"
        role="tablist"
        aria-label="Choose one capture to inspect"
      >
        {TRACK_SLOTS.map((slot, index) => {
          const candidate = captures[slot];
          const selected = slot === selectedSlot;
          return (
            <button
              key={slot}
              ref={(node) => {
                if (node) trackTabRefs.current.set(slot, node);
                else trackTabRefs.current.delete(slot);
              }}
              id={`${panelId}-${slot.toLowerCase()}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              data-selected={selected || undefined}
              data-slot={slot}
              onClick={() => selectTrack(slot)}
              onKeyDown={(event) => handleTrackKeyDown(event, index)}
            >
              <span className="track-selector-letter">{slot}</span>
              <span>
                <strong>Input {slot}</strong>
                <small>{candidate.deviceLabel}</small>
              </span>
              <em>{selected ? "Inspecting" : "Open track"}</em>
            </button>
          );
        })}
      </div>

      <div
        id={panelId}
        className="track-review-panel"
        role="tabpanel"
        aria-labelledby={`${panelId}-${selectedSlot.toLowerCase()}-tab`}
      >
        <div className="track-instrument">
          <InstrumentRegistration />
          <header className="track-instrument-heading">
            <div>
              <p className="instrument-label">
                Viewing Input {selectedSlot} only
              </p>
              <h2>{capture.deviceLabel}</h2>
              <p>Recorded level · no loudness matching or normalization</p>
            </div>
            <ViewTabs
              view={view}
              onChange={setView}
              panelId={`${panelId}-plot`}
              idPrefix={`${panelId}-view`}
              ariaLabel={`Input ${selectedSlot} evidence view`}
            />
          </header>

          <div
            id={`${panelId}-plot`}
            role="tabpanel"
            aria-labelledby={`${panelId}-view-${view}-tab`}
            className="track-plot-panel"
          >
            <p className="track-view-note">
              {view === "waveform"
                ? "Recorded amplitude · full scale ±1 · time in seconds"
                : view === "spectrum"
                  ? "Magnitude · −120 to 0 dBFS · logarithmic frequency"
                  : "RMS envelope · −120 to 0 dBFS · time in seconds"}
            </p>
            <SignalPlot
              tracks={plotTracks}
              view={view}
              segments={READING_SEGMENTS}
              duration={GUIDED_READING_DURATION_SECONDS}
              playhead={
                view === "spectrum"
                  ? 0
                  : currentTime / GUIDED_READING_DURATION_SECONDS
              }
              ariaLabel={`Input ${selectedSlot} ${view} for the guided reading`}
            />
          </div>

          <Transport
            playing={selectedPlaying}
            currentTime={currentTime}
            duration={GUIDED_READING_DURATION_SECONDS}
            onToggle={() => onPlay(selectedSlot)}
            onSeek={onSeek}
            label={`Input ${selectedSlot}`}
          />

          <InstrumentMetadata
            label={`Input ${selectedSlot} capture evidence`}
            items={[
              { label: "Protocol", value: capture.protocolId },
              {
                label: "Duration",
                value: `${assessment.durationSeconds.toFixed(1)} s`,
              },
              {
                label: "Sample rate",
                value: `${(capture.sampleRate / 1_000).toFixed(1)} kHz`,
              },
              { label: "View", value: view },
            ]}
          />
        </div>

        <section className="track-detail" aria-labelledby="track-detail-title">
          <header className="track-detail-heading">
            <p className="instrument-label">Measured detail</p>
            <h2 id="track-detail-title">Input {selectedSlot}, cue by cue.</h2>
            <p>Choose any cue or finding to move the playback position.</p>
          </header>

          <TrackMetrics capture={capture} assessment={assessment} />

          <div
            className="track-cues"
            aria-label="Guided reading cue measurements"
          >
            {assessment.cues.map((cue) => (
              <button
                key={cue.cueId}
                type="button"
                onClick={() => onSeek(cue.startSeconds)}
                aria-label={`Jump to ${cue.label}, ${formatRange(cue.startSeconds, cue.endSeconds)}`}
              >
                <span>
                  <strong>{cue.label}</strong>
                  <small>{formatRange(cue.startSeconds, cue.endSeconds)}</small>
                </span>
                <em>{cue.complete ? formatDb(cue.rmsDbFs) : "Incomplete"}</em>
              </button>
            ))}
          </div>

          <div className="track-insights">
            <InsightGroup
              tone="strength"
              insights={insightsFor("strength")}
              onSeek={onSeek}
            />
            <InsightGroup
              tone="attention"
              insights={insightsFor("attention")}
              onSeek={onSeek}
            />
            <InsightGroup
              tone="context"
              insights={insightsFor("context")}
              onSeek={onSeek}
            />
          </div>
        </section>
      </div>

      <div className="track-review-footer">
        <p className="track-review-qualification">
          <Info size={17} aria-hidden="true" />
          These measurements describe this recording. Voice delivery, distance,
          position, room sound, and browser or device processing can all affect
          the result; they do not diagnose the hardware by themselves.
        </p>
        <div className="track-review-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onRepeat}
          >
            <RotateCcw size={18} />
            Repeat both captures
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onUpgrade}
          >
            Upgrade Input A
            <ArrowRight size={19} />
          </button>
        </div>
        <p className="privacy-note">
          <Info size={16} />
          {signalMode === "live"
            ? "Upgrade access is private and expires after 24 hours."
            : "Audio stays in this tab and is released when you reset or close it."}
        </p>
      </div>
    </section>
  );
}
