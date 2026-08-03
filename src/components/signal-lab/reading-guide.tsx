import { useId, type CSSProperties } from "react";

import {
  getGuidedReadingCueIndex,
  getGuidedReadingProgress,
  GUIDED_READING_CUES,
  GUIDED_READING_DURATION_SECONDS,
  GUIDED_READING_ID,
} from "@/lib/audio/reading-passage";

export type ReadingGuideState =
  "prepare" | "practice" | "countdown" | "capturing" | "analyzing" | "complete";

type ReadingGuideProps = {
  state: ReadingGuideState;
  elapsedSeconds?: number;
  countdownSeconds?: number;
  slot?: "A" | "B";
};

function formatSeconds(seconds: number) {
  return `0:${Math.max(0, Math.floor(seconds)).toString().padStart(2, "0")}`;
}

function cueState(
  cueIndex: number,
  activeIndex: number,
  state: ReadingGuideState,
) {
  if (state === "prepare" || state === "countdown") return "future";
  if (state === "analyzing" || state === "complete") return "complete";
  if (cueIndex < activeIndex) return "complete";
  if (cueIndex === activeIndex) return "active";
  return "future";
}

export function ReadingGuide({
  state,
  elapsedSeconds = 0,
  countdownSeconds = 3,
  slot,
}: Readonly<ReadingGuideProps>) {
  const titleId = useId();
  const finiteElapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const boundedElapsed = Math.max(
    0,
    Math.min(GUIDED_READING_DURATION_SECONDS, finiteElapsed),
  );
  const activeIndex = getGuidedReadingCueIndex(boundedElapsed);
  const progress = getGuidedReadingProgress(boundedElapsed);
  const hasActiveCue = state === "practice" || state === "capturing";

  return (
    <section
      className="reading-guide"
      data-state={state}
      data-slot={slot}
      aria-labelledby={titleId}
    >
      <header className="reading-guide-header">
        <div>
          <p className="instrument-label">Guided reading · 20 seconds</p>
          <h2 id={titleId}>
            {state === "prepare"
              ? "Read one measured passage."
              : `Reading plate${slot ? ` · Input ${slot}` : ""}`}
          </h2>
        </div>
        <time
          className="reading-guide-time"
          aria-label="Reading time"
          dateTime={`PT${boundedElapsed.toFixed(1)}S`}
        >
          {formatSeconds(boundedElapsed)} <span>/</span> 0:20
        </time>
      </header>

      {state === "countdown" ? (
        <div className="reading-countdown" aria-hidden="true">
          <span>Recording begins in</span>
          <strong>{Math.max(1, Math.ceil(countdownSeconds))}</strong>
        </div>
      ) : null}

      <div className="reading-timeline" aria-hidden="true">
        {GUIDED_READING_CUES.map((cue, index) => {
          const stateForCue = cueState(index, activeIndex, state);
          const style = {
            "--cue-span": cue.endSeconds - cue.startSeconds,
          } as CSSProperties;
          return <span key={cue.id} data-state={stateForCue} style={style} />;
        })}
        <i style={{ left: `${progress * 100}%` }} />
      </div>

      <ol className="reading-cues" aria-label="Timed reading passage">
        {GUIDED_READING_CUES.map((cue, index) => {
          const stateForCue = cueState(index, activeIndex, state);
          const active = hasActiveCue && stateForCue === "active";
          return (
            <li
              key={cue.id}
              data-state={stateForCue}
              data-cue={cue.id}
              aria-current={active ? "step" : undefined}
            >
              <div className="reading-cue-meta">
                <span>{cue.label}</span>
                <span>
                  {formatSeconds(cue.startSeconds)}–
                  {formatSeconds(cue.endSeconds)}
                </span>
              </div>
              <p className="reading-cue-instruction">
                {active ? <strong>Read now · </strong> : null}
                {cue.instruction}
              </p>
              {cue.text === null ? (
                <p className="reading-cue-silence">
                  No reading during this cue.
                </p>
              ) : (
                <p className="reading-cue-text">{cue.text}</p>
              )}
            </li>
          );
        })}
      </ol>

      <footer className="reading-guide-footer">
        <span>{GUIDED_READING_ID}</span>
        <span>Keep your distance and pace steady for both inputs.</span>
      </footer>
    </section>
  );
}
