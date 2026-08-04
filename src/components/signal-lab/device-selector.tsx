import { CheckCircle2, ChevronDown, Headphones, Mic } from "lucide-react";

import type { DeviceChoice } from "./types";

type DeviceSelectorProps = {
  label: "Input A" | "Input B";
  devices: readonly DeviceChoice[];
  selectedId: string;
  confirmed: boolean;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
  onConfirm: () => void;
};

function deviceIcon(label: string) {
  return /airpod|head|ear|bluetooth/i.test(label) ? (
    <Headphones size={20} />
  ) : (
    <Mic size={20} />
  );
}

export function DeviceSelector({
  label,
  devices,
  selectedId,
  confirmed,
  disabled = false,
  onChange,
  onConfirm,
}: Readonly<DeviceSelectorProps>) {
  const selected = devices.find((device) => device.deviceId === selectedId);

  return (
    <fieldset className="device-fieldset" disabled={disabled}>
      <legend>{label}</legend>
      <div
        className="device-select-shell"
        data-confirmed={confirmed || undefined}
      >
        <span className="device-icon" aria-hidden="true">
          {deviceIcon(selected?.label ?? "")}
        </span>
        <select
          aria-label={`${label} device`}
          title={selected?.label}
          value={selectedId}
          onChange={(event) => onChange(event.target.value)}
        >
          {devices.length === 0 ? (
            <option value="">Microphone access required</option>
          ) : null}
          {devices.map((device, index) => (
            <option value={device.deviceId} key={device.deviceId}>
              {device.label || `Audio input ${index + 1}`}
            </option>
          ))}
        </select>
        <ChevronDown className="device-chevron" size={17} aria-hidden="true" />
      </div>
      <button
        className="button button-quiet confirm-device"
        type="button"
        onClick={onConfirm}
        disabled={!selectedId}
      >
        <CheckCircle2 size={17} />
        {confirmed ? "Device confirmed" : "Confirm device"}
      </button>
      <p className="browser-label">Browser-reported name</p>
    </fieldset>
  );
}
