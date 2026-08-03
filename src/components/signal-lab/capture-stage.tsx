import {
  CheckCircle2,
  Circle,
  Info,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Square,
} from "lucide-react";

import {
  getGuidedReadingCue,
  GUIDED_READING_DURATION_SECONDS,
} from "@/lib/audio/reading-passage";

import { ReadingGuide, type ReadingGuideState } from "./reading-guide";

export type CapturePhase =
  | "idle"
  | "arming"
  | "countdown"
  | "capturing"
  | "analyzing"
  | "complete"
  | "error";

type CaptureStageProps = {
  slot: "A" | "B";
  deviceLabel: string;
  phase?: CapturePhase;
  /** Legacy fallback while the root migrates to CapturePhase. */
  recording?: boolean;
  progress?: number;
  elapsedSeconds?: number;
  countdownSeconds?: number;
  error?: string | undefined;
  reviewPlaying?: boolean;
  onStart: () => void;
  onCancel: () => void;
  onContinue?: () => void;
  onRetake?: () => void;
  onToggleReview?: () => void;
};

function timeRemaining(elapsedSeconds: number) {
  return Math.max(0, GUIDED_READING_DURATION_SECONDS - elapsedSeconds).toFixed(
    1,
  );
}

function guideState(phase: CapturePhase): ReadingGuideState {
  if (phase === "countdown") return "countdown";
  if (phase === "capturing") return "capturing";
  if (phase === "analyzing") return "analyzing";
  if (phase === "complete") return "complete";
  return "prepare";
}

function statusText(
  phase: CapturePhase,
  slot: "A" | "B",
  elapsedSeconds: number,
  countdownSeconds: number,
) {
  if (phase === "arming") return "Connecting Input " + slot;
  if (phase === "countdown")
    return "Recording begins in " + Math.max(1, Math.ceil(countdownSeconds));
  if (phase === "capturing") {
    const cue = getGuidedReadingCue(elapsedSeconds);
    return cue.id === "room-tone"
      ? "Recording Input " + slot + " · Stay silent"
      : "Recording Input " + slot + " · " + cue.label;
  }
  if (phase === "analyzing") return "Analyzing Input " + slot;
  if (phase === "complete") return "Input " + slot + " captured";
  if (phase === "error") return "Input " + slot + " needs attention";
  return "Input " + slot + " is ready";
}

function ChecklistIcon({
  state,
}: Readonly<{ state: "complete" | "active" | "future" }>) {
  if (state === "complete") return <CheckCircle2 size={17} />;
  if (state === "active") return <Radio size={17} />;
  return <Circle size={17} />;
}

export function CaptureStage({
  slot,
  deviceLabel,
  phase,
  recording = false,
  progress = 0,
  elapsedSeconds,
  countdownSeconds = 3,
  error,
  reviewPlaying = false,
  onStart,
  onCancel,
  onContinue,
  onRetake,
  onToggleReview,
}: Readonly<CaptureStageProps>) {
  const resolvedPhase: CapturePhase =
    phase ??
    (error
      ? "error"
      : recording
        ? "capturing"
        : progress >= 1
          ? "complete"
          : "idle");
  const finiteElapsed = Number.isFinite(elapsedSeconds)
    ? (elapsedSeconds ?? 0)
    : 0;
  const finiteProgress = Number.isFinite(progress) ? progress : 0;
  const resolvedElapsed = Math.max(
    0,
    Math.min(
      GUIDED_READING_DURATION_SECONDS,
      elapsedSeconds === undefined
        ? finiteProgress * GUIDED_READING_DURATION_SECONDS
        : finiteElapsed,
    ),
  );
  const isActive =
    resolvedPhase === "arming" ||
    resolvedPhase === "countdown" ||
    resolvedPhase === "capturing";
  const countInComplete =
    resolvedPhase === "capturing" ||
    resolvedPhase === "analyzing" ||
    resolvedPhase === "complete";
  const readingComplete =
    resolvedPhase === "analyzing" || resolvedPhase === "complete";
  const countInState = countInComplete
    ? "complete"
    : resolvedPhase === "arming" || resolvedPhase === "countdown"
      ? "active"
      : "future";
  const readingState = readingComplete
    ? "complete"
    : resolvedPhase === "capturing"
      ? "active"
      : "future";
  const analysisState =
    resolvedPhase === "complete"
      ? "complete"
      : resolvedPhase === "analyzing"
        ? "active"
        : "future";

  return (
    <section className="stage stage-capture" aria-labelledby="capture-title">
      <aside className="capture-rail">
        <p className="instrument-label">Input {slot}</p>
        <h1 id="capture-title" tabIndex={-1}>
          Read one measured passage.
        </h1>
        <p className="lede">
          After the count-in, stay silent for two seconds, then follow the
          highlighted phrases. Keep your position and speaking style steady.
        </p>

        <div className="capture-device">
          <span className="capture-device-mark" aria-hidden="true">
            <Radio size={18} />
          </span>
          <div>
            <span>Recording from</span>
            <strong>{deviceLabel}</strong>
          </div>
        </div>

        <ol className="capture-checklist" aria-label="Capture checklist">
          <li data-state="complete">
            <CheckCircle2 size={17} /> Input {slot} confirmed
          </li>
          <li data-state={countInState}>
            <ChecklistIcon state={countInState} />
            Three-second count-in
          </li>
          <li data-state={readingState}>
            <ChecklistIcon state={readingState} />
            Guided reading
          </li>
          <li data-state={analysisState}>
            <ChecklistIcon state={analysisState} />
            Browser analysis
          </li>
        </ol>

        {resolvedPhase === "complete" ? (
          <div className="capture-review-actions">
            {onToggleReview ? (
              <button
                type="button"
                className="button button-secondary capture-action"
                onClick={onToggleReview}
              >
                {reviewPlaying ? <Pause size={17} /> : <Play size={17} />}
                {reviewPlaying ? "Pause Input" : "Listen to Input"} {slot}
              </button>
            ) : null}
            {onRetake ? (
              <button
                type="button"
                className="button button-secondary capture-action"
                onClick={onRetake}
              >
                <RotateCcw size={17} />
                Record Input {slot} again
              </button>
            ) : null}
            {onContinue ? (
              <button
                type="button"
                className="button button-primary capture-action"
                onClick={onContinue}
              >
                {slot === "A"
                  ? "Continue to Input B"
                  : "Review individual tracks"}
              </button>
            ) : null}
          </div>
        ) : isActive ? (
          <button
            type="button"
            className="button button-secondary capture-action"
            onClick={onCancel}
          >
            <Square size={15} fill="currentColor" />
            Stop capture
          </button>
        ) : resolvedPhase === "analyzing" ? (
          <button
            type="button"
            className="button button-secondary capture-action"
            disabled
          >
            Analyzing capture…
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary capture-action"
            onClick={onStart}
          >
            <Radio size={18} />
            Start three-second count-in
          </button>
        )}

        <p className="privacy-note">
          <Info size={16} />
          Audio remains in this browser.
        </p>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </aside>

      <div className="capture-instrument">
        <div className="capture-status">
          <div role="status" aria-live="polite" aria-atomic="true">
            <span
              className="recording-dot"
              data-live={resolvedPhase === "capturing" ? true : undefined}
              aria-hidden="true"
            />
            <span>
              {statusText(
                resolvedPhase,
                slot,
                resolvedElapsed,
                countdownSeconds,
              )}
            </span>
          </div>
          <time
            aria-label="Capture time remaining"
            dateTime={`PT${Math.max(0, GUIDED_READING_DURATION_SECONDS - resolvedElapsed).toFixed(1)}S`}
          >
            {resolvedPhase === "capturing"
              ? timeRemaining(resolvedElapsed) + " seconds remain"
              : resolvedPhase === "complete"
                ? resolvedElapsed.toFixed(1) + " seconds captured"
                : "20.0 seconds"}
          </time>
        </div>

        <ReadingGuide
          state={guideState(resolvedPhase)}
          elapsedSeconds={resolvedElapsed}
          countdownSeconds={countdownSeconds}
          slot={slot}
        />

        <div className="capture-meter" aria-hidden="true">
          <span
            style={{
              width:
                (resolvedElapsed / GUIDED_READING_DURATION_SECONDS) * 100 + "%",
            }}
          />
        </div>
        <div className="capture-guidance">
          <span>Silent for the first two seconds</span>
          <span>Follow the highlighted phrase</span>
          <span>Keep the device and your position steady</span>
        </div>
      </div>
    </section>
  );
}
