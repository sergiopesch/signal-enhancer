export type DeviceChoice = {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
};

export type CaptureMetrics = {
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number;
  dynamicRangeDb: number;
  clippingPercent: number;
  highFrequencyRatio: number;
};

export type CaptureRecord = {
  slot: "A" | "B";
  blob: Blob;
  url: string;
  samples: Float32Array;
  sampleRate: number;
  waveform: number[];
  spectrum: number[];
  metrics: CaptureMetrics;
  deviceLabel: string;
};

export type Observation = {
  title: string;
  detail: string;
  kind: "frequency" | "noise" | "dynamics";
};

export type UpgradeEvent = {
  sequence: number;
  stage: string;
  detail: string;
  status: "complete" | "active" | "future" | "failed";
  timestamp?: string;
};
