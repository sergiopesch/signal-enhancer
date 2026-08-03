import { ArrowRight, Info, Mic, Play } from "lucide-react";

import { DeviceSelector } from "./device-selector";
import {
  InstrumentMetadata,
  InstrumentRegistration,
} from "./instrument-chrome";
import { makeReferenceEnvelope, SignalPlot } from "./signal-plot";
import { Transport } from "./transport";
import type { DeviceChoice } from "./types";

type ReferenceStageProps = {
  devices: readonly DeviceChoice[];
  inputA: string;
  inputB: string;
  confirmedA: boolean;
  confirmedB: boolean;
  permissionState: "idle" | "requesting" | "granted" | "denied";
  permissionMessage: string | undefined;
  playing: boolean;
  currentTime: number;
  onInputA: (id: string) => void;
  onInputB: (id: string) => void;
  onConfirmA: () => void;
  onConfirmB: () => void;
  onRequestPermission: () => void;
  onToggleReference: () => void;
  onSeekReference: (time: number) => void;
  onBegin: () => void;
};

export function ReferenceStage({
  devices,
  inputA,
  inputB,
  confirmedA,
  confirmedB,
  permissionState,
  permissionMessage,
  playing,
  currentTime,
  onInputA,
  onInputB,
  onConfirmA,
  onConfirmB,
  onRequestPermission,
  onToggleReference,
  onSeekReference,
  onBegin,
}: Readonly<ReferenceStageProps>) {
  const ready = confirmedA && confirmedB;

  return (
    <section
      className="stage stage-reference"
      aria-labelledby="reference-title"
    >
      <div className="setup-rail">
        <h1 id="reference-title">Listen to the chain.</h1>
        <p className="lede">
          The same sound will travel through two input chains. We’ll show how
          each one reshapes it—without calling either better.
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
        <p className="privacy-note">
          <Info size={16} />
          20 seconds · WAV · stays on this device until you upgrade
        </p>
      </div>

      <div className="reference-instrument">
        <InstrumentRegistration />
        <div className="instrument-heading">
          <div>
            <p className="instrument-label">Reference sound</p>
            <button
              className="button button-secondary preview-reference"
              type="button"
              onClick={onToggleReference}
            >
              <Play size={17} fill="currentColor" />
              Preview reference
            </button>
          </div>
          <div className="mini-legend" aria-label="Plot legend">
            <span>
              <i data-color="amber" />
              Playhead
            </span>
            <span>
              <i data-color="cyan" />
              Input gate
            </span>
          </div>
        </div>
        <SignalPlot
          tracks={[
            {
              id: "reference",
              label: "Reference",
              color: "cyan",
              samples: makeReferenceEnvelope(),
            },
          ]}
          playhead={currentTime / 20}
          ariaLabel="Twenty second reference waveform: silence, sweep, clicks, quiet probe, then loud probe"
        />
        <InstrumentMetadata
          label="Reference evidence"
          items={[
            { label: "Reference", value: "diagnostic-speech-v1" },
            { label: "Duration", value: "20.0 s" },
            { label: "Sample rate", value: "48 kHz" },
            { label: "Channels", value: "Mono" },
          ]}
        />
        <Transport
          playing={playing}
          currentTime={currentTime}
          onToggle={onToggleReference}
          onSeek={onSeekReference}
        />
      </div>
    </section>
  );
}
