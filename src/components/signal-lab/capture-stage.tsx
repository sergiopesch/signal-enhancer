import { CheckCircle2, Circle, Info, Radio, Square } from "lucide-react";

import { makeReferenceEnvelope, SignalPlot } from "./signal-plot";

type CaptureStageProps = {
  slot: "A" | "B";
  deviceLabel: string;
  recording: boolean;
  progress: number;
  error: string | undefined;
  onStart: () => void;
  onCancel: () => void;
};

function timeRemaining(progress: number) {
  return Math.max(0, 20 - progress * 20).toFixed(1);
}

export function CaptureStage({
  slot,
  deviceLabel,
  recording,
  progress,
  error,
  onStart,
  onCancel,
}: Readonly<CaptureStageProps>) {
  return (
    <section className="stage stage-capture" aria-labelledby="capture-title">
      <aside className="capture-rail">
        <p className="instrument-label">Input {slot}</p>
        <h1 id="capture-title">Hold the room still.</h1>
        <p className="lede">
          Keep the reference volume, position, and distance unchanged. We’ll
          record exactly one pass through this input chain.
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
          <li data-state={recording ? "active" : "future"}>
            {recording ? <Radio size={17} /> : <Circle size={17} />} Reference
            and capture run together
          </li>
          <li data-state={progress >= 1 ? "complete" : "future"}>
            {progress >= 1 ? <CheckCircle2 size={17} /> : <Circle size={17} />}{" "}
            Browser analysis
          </li>
        </ol>

        {!recording ? (
          <button
            type="button"
            className="button button-primary capture-action"
            onClick={onStart}
          >
            <Radio size={18} />
            Capture Input {slot}
          </button>
        ) : (
          <button
            type="button"
            className="button button-secondary capture-action"
            onClick={onCancel}
          >
            <Square size={15} fill="currentColor" />
            Stop capture
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
        <div className="capture-status" aria-live="polite">
          <div>
            <span
              className="recording-dot"
              data-live={recording || undefined}
            />
            <span>
              {recording ? `Capturing Input ${slot}` : `Input ${slot} is ready`}
            </span>
          </div>
          <output>
            {recording
              ? `${timeRemaining(progress)} seconds remain`
              : "20.0 seconds"}
          </output>
        </div>
        <SignalPlot
          tracks={[
            {
              id: `capture-${slot}`,
              label: `Input ${slot}`,
              color: slot === "A" ? "cyan" : "amber",
              samples: makeReferenceEnvelope(620, slot === "A" ? 0 : 1),
            },
          ]}
          activeGate={recording ? progress : 0}
          playhead={recording ? progress : 0}
          ariaLabel={`Capture timeline for Input ${slot}`}
        />
        <div className="capture-meter" aria-hidden="true">
          <span
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        </div>
        <div className="capture-guidance">
          <span>Silence first</span>
          <span>Keep the device steady</span>
          <span>Do not speak over the reference</span>
        </div>
      </div>
    </section>
  );
}
