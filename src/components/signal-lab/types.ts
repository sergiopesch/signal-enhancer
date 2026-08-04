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
  protocolId: string;
  blob: Blob;
  url: string;
  samples: Float32Array;
  sampleRate: number;
  waveform: number[];
  spectrum: number[];
  spectrumFrequenciesHz: number[];
  dynamics: number[];
  metrics: CaptureMetrics;
  deviceLabel: string;
};

export type UpgradeEvent = {
  sequence: number;
  stage: string;
  detail: string;
  status: "complete" | "active" | "future" | "failed";
  timestamp?: string;
};

export type UpgradeProvenance = {
  engine: "resemble";
  modelName: "resemble-enhance";
  modelRepository: string;
  modelRevision: string;
  checkpointSha256: string;
  sourceRevision: string;
  pipelineRevision: string;
  inferenceProfile: string;
};
