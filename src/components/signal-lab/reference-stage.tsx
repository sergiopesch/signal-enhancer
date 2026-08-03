"use client";

import { ArrowRight, Info, Mic, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  GUIDED_READING_DURATION_SECONDS,
  GUIDED_READING_ID,
  GUIDED_READING_VERSION,
} from "@/lib/audio/reading-passage";

import { DeviceSelector } from "./device-selector";
import {
  InstrumentMetadata,
  InstrumentRegistration,
} from "./instrument-chrome";
import { ReadingGuide } from "./reading-guide";
import type { DeviceChoice } from "./types";

type ReferenceStageProps = {
  devices: readonly DeviceChoice[];
  inputA: string;
  inputB: string;
  confirmedA: boolean;
  confirmedB: boolean;
  permissionState: "idle" | "requesting" | "granted" | "denied";
  permissionMessage: string | undefined;
  /** @deprecated The guided-reading plate no longer plays reference audio. */
  playing?: boolean;
  /** @deprecated The guided-reading plate owns a silent practice timeline. */
  currentTime?: number;
  onInputA: (id: string) => void;
  onInputB: (id: string) => void;
  onConfirmA: () => void;
  onConfirmB: () => void;
  onRequestPermission: () => void;
  /** @deprecated Retained while the root migrates to guided reading. */
  onToggleReference?: () => void;
  /** @deprecated Retained while the root migrates to guided reading. */
  onSeekReference?: (time: number) => void;
  onBegin: () => void;
  practicePlaying?: boolean;
  practiceElapsedSeconds?: number;
  onTogglePractice?: () => void;
  onRestartPractice?: () => void;
};

export function ReferenceStage({
  devices,
  inputA,
  inputB,
  confirmedA,
  confirmedB,
  permissionState,
  permissionMessage,
  onInputA,
  onInputB,
  onConfirmA,
  onConfirmB,
  onRequestPermission,
  onBegin,
  practicePlaying,
  practiceElapsedSeconds,
  onTogglePractice,
  onRestartPractice,
}: Readonly<ReferenceStageProps>) {
  const ready = confirmedA && confirmedB;
  const controlledPractice =
    practicePlaying !== undefined && practiceElapsedSeconds !== undefined;
  const [internalPracticePlaying, setInternalPracticePlaying] = useState(false);
  const [internalPracticeElapsed, setInternalPracticeElapsed] = useState(0);
  const practiceElapsedRef = useRef(0);
  const resolvedPracticePlaying = controlledPractice
    ? (practicePlaying ?? false)
    : internalPracticePlaying;
  const resolvedPracticeElapsed = controlledPractice
    ? (practiceElapsedSeconds ?? 0)
    : internalPracticeElapsed;

  useEffect(() => {
    if (controlledPractice || !internalPracticePlaying) return;
    const startedAt = performance.now() - practiceElapsedRef.current * 1_000;
    const timer = window.setInterval(() => {
      const next = Math.min(
        GUIDED_READING_DURATION_SECONDS,
        (performance.now() - startedAt) / 1_000,
      );
      practiceElapsedRef.current = next;
      setInternalPracticeElapsed(next);
      if (next >= GUIDED_READING_DURATION_SECONDS)
        setInternalPracticePlaying(false);
    }, 100);
    return () => window.clearInterval(timer);
  }, [controlledPractice, internalPracticePlaying]);

  const togglePractice = () => {
    if (controlledPractice) {
      onTogglePractice?.();
      return;
    }
    if (
      !internalPracticePlaying &&
      practiceElapsedRef.current >= GUIDED_READING_DURATION_SECONDS
    ) {
      practiceElapsedRef.current = 0;
      setInternalPracticeElapsed(0);
    }
    setInternalPracticePlaying((current) => !current);
    onTogglePractice?.();
  };

  const restartPractice = () => {
    if (controlledPractice) {
      onRestartPractice?.();
      return;
    }
    practiceElapsedRef.current = 0;
    setInternalPracticeElapsed(0);
    setInternalPracticePlaying(false);
    onRestartPractice?.();
  };

  return (
    <section
      className="stage stage-reference"
      aria-labelledby="reference-title"
    >
      <div className="setup-rail">
        <h1 id="reference-title" tabIndex={-1}>
          Prepare your reading.
        </h1>
        <p className="lede">
          Read the same short passage into Input A, then Input B. Keep your
          position, distance, and speaking style steady so the input chain
          remains the meaningful difference.
        </p>
        <p className="setup-upgrade-note">
          Input A is the recording Signal Enhancer will upgrade.
        </p>

        <p className="instrument-label setup-label">Choose your inputs</p>
        <div className="device-stack">
          <DeviceSelector
            label="Input A"
            devices={devices}
            selectedId={inputA}
            confirmed={confirmedA}
            disabled={permissionState === "requesting"}
            onChange={onInputA}
            onConfirm={onConfirmA}
          />
          <DeviceSelector
            label="Input B"
            devices={devices}
            selectedId={inputB}
            confirmed={confirmedB}
            disabled={permissionState === "requesting"}
            onChange={onInputB}
            onConfirm={onConfirmB}
          />
        </div>

        {permissionState !== "granted" ? (
          <button
            className="button button-secondary permission-action"
            type="button"
            onClick={onRequestPermission}
            disabled={permissionState === "requesting"}
          >
            <Mic size={18} />
            {permissionState === "requesting"
              ? "Waiting for permission…"
              : "Enable microphone inputs"}
          </button>
        ) : null}
        {permissionMessage ? (
          <p className="inline-error" role="alert">
            {permissionMessage}
          </p>
        ) : null}

        <button
          className="button button-primary begin-action"
          type="button"
          onClick={onBegin}
          disabled={!ready}
        >
          <span>Begin Input A</span>
          <ArrowRight size={19} />
        </button>
        <p className="begin-requirement" aria-live="polite">
          {ready
            ? "Both inputs are confirmed. You can begin Input A."
            : "Confirm both inputs to continue."}
        </p>
        <p className="privacy-note">
          <Info size={16} />
          20 seconds · WAV · stays on this device until you upgrade
        </p>
      </div>

      <div className="reference-instrument">
        <InstrumentRegistration />
        <div className="instrument-heading">
          <div>
            <p className="instrument-label">Reading passage</p>
            <p className="practice-note">
              Practice is silent and not recorded.
            </p>
          </div>
          <div className="practice-actions">
            <button
              className="button button-secondary preview-reference"
              type="button"
              onClick={togglePractice}
            >
              {resolvedPracticePlaying ? (
                <Pause size={17} />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {resolvedPracticePlaying
                ? "Pause practice"
                : "Practice the timing"}
            </button>
            {resolvedPracticeElapsed > 0 ? (
              <button
                className="button button-quiet restart-practice"
                type="button"
                onClick={restartPractice}
              >
                <RotateCcw size={16} />
                Reset
              </button>
            ) : null}
          </div>
        </div>
        <ReadingGuide
          state={
            resolvedPracticeElapsed >= GUIDED_READING_DURATION_SECONDS
              ? "complete"
              : resolvedPracticeElapsed > 0 || resolvedPracticePlaying
                ? "practice"
                : "prepare"
          }
          elapsedSeconds={resolvedPracticeElapsed}
        />
        <InstrumentMetadata
          label="Reading protocol"
          items={[
            { label: "Reference", value: GUIDED_READING_ID },
            { label: "Duration", value: "20.0 s" },
            { label: "Passage", value: "36 words" },
            { label: "Version", value: GUIDED_READING_VERSION },
          ]}
        />
      </div>
    </section>
  );
}
