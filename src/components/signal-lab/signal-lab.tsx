"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeAudio,
  capturePcmWav,
  createDspPreview,
  createReferenceDiagnostic,
  encodeWav,
  listAudioInputs,
  playReferenceDiagnostic,
  requestAudioPermission,
  stopMediaStream,
  type AudioAnalysis,
  type ReferencePlaybackController,
} from "@/lib/audio";

import { AboutDialog } from "./about-dialog";
import { CaptureStage } from "./capture-stage";
import { ExperimentStepper, type ExperimentStage } from "./experiment-stepper";
import { ReferenceStage } from "./reference-stage";
import { RevealStage } from "./reveal-stage";
import { SignalMark } from "./signal-mark";
import type {
  CaptureMetrics,
  CaptureRecord,
  DeviceChoice,
  Observation,
  UpgradeEvent,
} from "./types";
import { UpgradeStage } from "./upgrade-stage";

const SIGNAL_MODE =
  process.env.NEXT_PUBLIC_SIGNAL_MODE === "live" ? "live" : "demo";
const CAPTURE_SECONDS = 20;

type PlaybackGroup = {
  sources: AudioBufferSourceNode[];
  startedAt: number;
  offset: number;
};

function displayError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The audio device did not complete that action.";
}

function waveformValues(analysis: AudioAnalysis) {
  return analysis.waveform.map((bin) =>
    Math.abs(bin.max) >= Math.abs(bin.min) ? bin.max : bin.min,
  );
}

function highFrequencyRatio(analysis: AudioAnalysis) {
  let total = 0;
  let high = 0;
  for (const bin of analysis.spectrum) {
    const power = bin.magnitude * bin.magnitude;
    total += power;
    if (bin.frequencyHz >= 4_000) high += power;
  }
  return total > 0 ? high / total : 0;
}

function toMetrics(analysis: AudioAnalysis): CaptureMetrics {
  return {
    rmsDb: analysis.metrics.rmsDbFs,
    peakDb: analysis.metrics.peakDbFs,
    noiseFloorDb: analysis.metrics.noiseFloorProxyDbFs,
    dynamicRangeDb: analysis.metrics.dynamicRangeProxyDb,
    clippingPercent: analysis.metrics.clippingFraction * 100,
    highFrequencyRatio: highFrequencyRatio(analysis),
  };
}

function makeRecord(
  slot: "A" | "B",
  samples: Float32Array,
  sampleRate: number,
  deviceLabel: string,
): CaptureRecord {
  const analysis = analyzeAudio(samples, sampleRate, {
    waveformBins: 620,
    spectrumBins: 120,
    dynamicsBins: 160,
  });
  const wavBytes = encodeWav(samples, sampleRate);
  const blob = new Blob([wavBytes], { type: "audio/wav" });
  return {
    slot,
    blob,
    url: URL.createObjectURL(blob),
    samples,
    sampleRate,
    waveform: waveformValues(analysis),
    spectrum: analysis.spectrum.map((bin) => bin.magnitudeDbFs),
    metrics: toMetrics(analysis),
    deviceLabel,
  };
}

function makeDemoCaptures() {
  const diagnostic = createReferenceDiagnostic(48_000);
  const a = new Float32Array(diagnostic.samples.length);
  const b = new Float32Array(diagnostic.samples.length);
  let smooth = 0;
  let seed = 0x13579bdf;
  for (let index = 0; index < diagnostic.samples.length; index += 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const noise = (seed / 4_294_967_296) * 2 - 1;
    const sample = diagnostic.samples[index] ?? 0;
    smooth += 0.16 * (sample - smooth);
    a[index] = Math.max(-0.98, Math.min(0.98, smooth * 1.07 + noise * 0.012));
    b[index] = Math.tanh((sample + noise * 0.004) * 1.45) * 0.72;
  }
  return {
    a: makeRecord(
      "A",
      a,
      diagnostic.sampleRate,
      "Laptop microphone · demonstration",
    ),
    b: makeRecord(
      "B",
      b,
      diagnostic.sampleRate,
      "Wireless headset · demonstration",
    ),
  };
}

function createObservations(a: CaptureRecord, b: CaptureRecord): Observation[] {
  const frequencyLeader =
    a.metrics.highFrequencyRatio > b.metrics.highFrequencyRatio
      ? "Input A"
      : "Input B";
  const noisier =
    a.metrics.noiseFloorDb > b.metrics.noiseFloorDb ? "Input A" : "Input B";
  const tighter =
    a.metrics.dynamicRangeDb < b.metrics.dynamicRangeDb ? "Input A" : "Input B";
  return [
    {
      kind: "frequency",
      title: `${frequencyLeader} carries more high-frequency energy`,
      detail:
        "The difference is most visible in the upper range during speech and the louder section.",
    },
    {
      kind: "noise",
      title: `${noisier} shows a higher steady noise-floor proxy`,
      detail:
        "The silence passage contains more persistent low-level energy in this capture.",
    },
    {
      kind: "dynamics",
      title: `${tighter}’s peaks appear more tightly controlled`,
      detail:
        "Transient spikes are smaller and more consistent relative to the rest of the signal.",
    },
  ];
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function SignalLab() {
  const [stage, setStage] = useState<ExperimentStage>("Reference");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceChoice[]>([]);
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [confirmedA, setConfirmedA] = useState(false);
  const [confirmedB, setConfirmedB] = useState(false);
  const [permissionState, setPermissionState] = useState<
    "idle" | "requesting" | "granted" | "denied"
  >("idle");
  const [permissionMessage, setPermissionMessage] = useState<string>();
  const [captureA, setCaptureA] = useState<CaptureRecord | null>(null);
  const [captureB, setCaptureB] = useState<CaptureRecord | null>(null);
  const [recording, setRecording] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureError, setCaptureError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [sessionId, setSessionId] = useState<string>();
  const [enhanced, setEnhanced] = useState<CaptureRecord | null>(null);
  const [upgradeState, setUpgradeState] = useState<
    "running" | "complete" | "failed"
  >("running");
  const [upgradeEvents, setUpgradeEvents] = useState<UpgradeEvent[]>([]);
  const [upgradeError, setUpgradeError] = useState<string>();

  const appShellRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const referenceRef = useRef<ReferencePlaybackController | null>(null);
  const referenceStartedAtRef = useRef(0);
  const playbackRef = useRef<PlaybackGroup | null>(null);
  const animationRef = useRef<number | null>(null);
  const captureAbortRef = useRef<AbortController | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const playbackSelectionRef = useRef<"original" | "enhanced">("enhanced");
  const enhancedRef = useRef<CaptureRecord | null>(null);
  const mountedRef = useRef(true);
  const objectUrlsRef = useRef(new Set<string>());

  const ownRecord = useCallback((record: CaptureRecord) => {
    if (!mountedRef.current) {
      URL.revokeObjectURL(record.url);
      return false;
    }
    objectUrlsRef.current.add(record.url);
    return true;
  }, []);

  const releaseRecord = useCallback((record: CaptureRecord | null) => {
    if (record && objectUrlsRef.current.delete(record.url))
      URL.revokeObjectURL(record.url);
  }, []);

  const releaseAllRecords = useCallback(() => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
  }, []);

  const replaceEnhanced = useCallback(
    (record: CaptureRecord) => {
      releaseRecord(enhancedRef.current);
      if (!ownRecord(record)) return false;
      enhancedRef.current = record;
      setEnhanced(record);
      return true;
    },
    [ownRecord, releaseRecord],
  );

  useEffect(() => {
    appShellRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  const ensureAudioContext = useCallback(() => {
    audioContextRef.current ??= new AudioContext({
      sampleRate: 48_000,
      latencyHint: "interactive",
    });
    return audioContextRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    referenceRef.current?.stop();
    referenceRef.current = null;
    playbackRef.current?.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    });
    playbackRef.current = null;
    if (animationRef.current !== null)
      cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setPlaying(false);
  }, []);

  const trackPlayback = useCallback(
    (startedAt: number, offset: number, context: AudioContext) => {
      const update = () => {
        const next = Math.min(
          CAPTURE_SECONDS,
          offset + context.currentTime - startedAt,
        );
        setCurrentTime(next);
        if (next >= CAPTURE_SECONDS) {
          setPlaying(false);
          setCurrentTime(0);
          animationRef.current = null;
          return;
        }
        animationRef.current = requestAnimationFrame(update);
      };
      animationRef.current = requestAnimationFrame(update);
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    const available = await listAudioInputs();
    const mapped: DeviceChoice[] = available.map((device) => ({
      deviceId: device.deviceId,
      label: device.displayLabel,
      kind: "audioinput",
    }));
    setDevices(mapped);
    setInputA((current) => current || mapped[0]?.deviceId || "");
    setInputB(
      (current) => current || mapped[1]?.deviceId || mapped[0]?.deviceId || "",
    );
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(
      () => void refreshDevices().catch(() => undefined),
      0,
    );
    const handleDeviceChange = () =>
      void refreshDevices().catch(() => undefined);
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      handleDeviceChange,
    );
    return () => {
      window.clearTimeout(initialRefresh);
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [refreshDevices]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPlayback();
      captureAbortRef.current?.abort();
      if (activeStreamRef.current) stopMediaStream(activeStreamRef.current);
      releaseAllRecords();
      void audioContextRef.current?.close();
    };
  }, [releaseAllRecords, stopPlayback]);

  const requestPermission = useCallback(async () => {
    setPermissionState("requesting");
    setPermissionMessage(undefined);
    try {
      const stream = await requestAudioPermission();
      stopMediaStream(stream);
      await refreshDevices();
      setPermissionState("granted");
    } catch (error) {
      setPermissionState("denied");
      setPermissionMessage(displayError(error));
    }
  }, [refreshDevices]);

  const toggleReference = useCallback(async () => {
    if (playing) {
      stopPlayback();
      return;
    }
    try {
      stopPlayback();
      const context = ensureAudioContext();
      const controller = await playReferenceDiagnostic(context, {
        offsetSeconds: currentTime,
      });
      referenceRef.current = controller;
      referenceStartedAtRef.current = context.currentTime;
      setPlaying(true);
      trackPlayback(context.currentTime, currentTime, context);
      void controller.ended.then(() => {
        if (referenceRef.current === controller) {
          referenceRef.current = null;
          setPlaying(false);
          setCurrentTime(0);
        }
      });
    } catch (error) {
      setPermissionMessage(displayError(error));
    }
  }, [currentTime, ensureAudioContext, playing, stopPlayback, trackPlayback]);

  const seekReference = useCallback(
    (time: number) => {
      stopPlayback();
      setCurrentTime(Math.max(0, Math.min(CAPTURE_SECONDS, time)));
    },
    [stopPlayback],
  );

  const createSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const byId = (id: string) =>
      devices.find((device) => device.deviceId === id)?.label ??
      "Browser audio input";
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referenceId: "diagnostic-speech-v1",
        devices: {
          inputA: { deviceId: inputA, label: byId(inputA) },
          inputB: { deviceId: inputB, label: byId(inputB) },
          requested: {
            channelCount: 1,
            sampleRate: 48_000,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          reported: {},
        },
      }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error?.message ??
          "The experiment session could not be started.",
      );
    const payload = (await response.json()) as { sessionId: string };
    setSessionId(payload.sessionId);
    return payload.sessionId;
  }, [devices, inputA, inputB, sessionId]);

  const beginInputA = useCallback(async () => {
    setCaptureError(undefined);
    try {
      await createSession();
      stopPlayback();
      setCurrentTime(0);
      setStage("Input A");
    } catch (error) {
      setPermissionMessage(displayError(error));
    }
  }, [createSession, stopPlayback]);

  const startCapture = useCallback(
    async (slot: "A" | "B") => {
      const deviceId = slot === "A" ? inputA : inputB;
      const deviceLabel =
        devices.find((device) => device.deviceId === deviceId)?.label ??
        `Input ${slot}`;
      setRecording(true);
      setCaptureProgress(0);
      setCaptureError(undefined);
      stopPlayback();
      const abortController = new AbortController();
      captureAbortRef.current = abortController;
      try {
        const stream = await requestAudioPermission(deviceId);
        activeStreamRef.current = stream;
        const context = ensureAudioContext();
        const capturePromise = capturePcmWav({
          stream,
          deviceId,
          durationMs: CAPTURE_SECONDS * 1_000,
          audioContext: context,
          signal: abortController.signal,
          onReady: () => {
            void playReferenceDiagnostic(context)
              .then((reference) => {
                referenceRef.current = reference;
              })
              .catch((error) => {
                setCaptureError(displayError(error));
                abortController.abort();
              });
          },
          onProgress: (progress) => setCaptureProgress(progress.ratio),
        });
        const result = await capturePromise;
        referenceRef.current?.stop();
        referenceRef.current = null;
        const analysis = analyzeAudio(result.samples, result.sampleRate, {
          waveformBins: 620,
          spectrumBins: 120,
          dynamicsBins: 160,
        });
        const record: CaptureRecord = {
          slot,
          blob: result.wav,
          url: URL.createObjectURL(result.wav),
          samples: result.samples,
          sampleRate: result.sampleRate,
          waveform: waveformValues(analysis),
          spectrum: analysis.spectrum.map((bin) => bin.magnitudeDbFs),
          metrics: toMetrics(analysis),
          deviceLabel,
        };
        if (!ownRecord(record)) return;
        if (slot === "A") {
          setCaptureA(record);
          setStage("Input B");
        } else {
          setCaptureB(record);
          setStage("Reveal");
        }
        setCurrentTime(0);
      } catch (error) {
        if (!abortController.signal.aborted)
          setCaptureError(displayError(error));
      } finally {
        if (activeStreamRef.current) stopMediaStream(activeStreamRef.current);
        activeStreamRef.current = null;
        captureAbortRef.current = null;
        setRecording(false);
      }
    },
    [devices, ensureAudioContext, inputA, inputB, ownRecord, stopPlayback],
  );

  const cancelCapture = useCallback(() => {
    captureAbortRef.current?.abort();
    referenceRef.current?.stop();
    referenceRef.current = null;
    setRecording(false);
    setCaptureProgress(0);
  }, []);

  const playRecords = useCallback(
    async (records: CaptureRecord[], offset = currentTime) => {
      stopPlayback();
      const context = ensureAudioContext();
      if (context.state === "suspended") await context.resume();
      const startAt = context.currentTime + 0.04;
      const sources = records.map((record) => {
        const buffer = context.createBuffer(
          1,
          record.samples.length,
          record.sampleRate,
        );
        buffer.copyToChannel(new Float32Array(record.samples), 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = records.length > 1 ? 0.5 : 1;
        source.connect(gain).connect(context.destination);
        source.start(startAt, Math.min(offset, buffer.duration));
        return source;
      });
      playbackRef.current = { sources, startedAt: startAt, offset };
      setPlaying(true);
      trackPlayback(startAt, offset, context);
      const first = sources[0];
      if (first) first.onended = () => setPlaying(false);
    },
    [currentTime, ensureAudioContext, stopPlayback, trackPlayback],
  );

  const handleRevealPlay = useCallback(
    (mode: "A" | "B" | "both") => {
      if (!captureA || !captureB) return;
      if (playing) {
        stopPlayback();
        return;
      }
      void playRecords(
        mode === "A"
          ? [captureA]
          : mode === "B"
            ? [captureB]
            : [captureA, captureB],
      );
    },
    [captureA, captureB, playRecords, playing, stopPlayback],
  );

  const seekCapture = useCallback(
    (time: number) => {
      stopPlayback();
      setCurrentTime(Math.max(0, Math.min(CAPTURE_SECONDS, time)));
    },
    [stopPlayback],
  );

  const uploadCapture = useCallback(
    async (session: string, record: CaptureRecord) => {
      const captureSha256 = await sha256(record.blob);
      const authorize = await fetch("/api/sessions/uploads/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session,
          slot: record.slot,
          bytes: record.blob.size,
          sha256: captureSha256,
        }),
      });
      if (!authorize.ok)
        throw new Error(
          (await authorize.json().catch(() => null))?.error?.message ??
            "Private upload could not be authorized.",
        );
      const grant = (await authorize.json()) as {
        committed: boolean;
        pathname: string;
        uploadUrl?: string;
        headers?: Record<string, string>;
      };
      if (grant.committed) return;
      if (!grant.uploadUrl || !grant.headers)
        throw new Error("The private upload grant was incomplete.");
      const uploaded = await fetch(grant.uploadUrl, {
        method: "PUT",
        headers: grant.headers,
        body: record.blob,
      });
      if (!uploaded.ok && uploaded.status !== 409)
        throw new Error("The capture could not be placed in private storage.");
      const committed = await fetch("/api/sessions/uploads/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session,
          slot: record.slot,
          pathname: grant.pathname,
          bytes: record.blob.size,
          sha256: captureSha256,
          durationMs: Math.round(
            (record.samples.length / record.sampleRate) * 1_000,
          ),
          sampleRate: record.sampleRate,
          channels: 1,
          codec: "pcm_s16le",
          metrics: record.metrics,
        }),
      });
      if (!committed.ok)
        throw new Error(
          (await committed.json().catch(() => null))?.error?.message ??
            "The capture upload could not be verified.",
        );
    },
    [],
  );

  const runDemoUpgrade = useCallback(async () => {
    const detail = [
      "The capture is ready in this browser.",
      "Measuring level, peaks, and spectral balance.",
      "Checking steady noise and peak control.",
      "Applying the local, non-AI preview route.",
      "Using restrained EQ and gentle dynamics.",
      "Comparing preview against the original.",
      "Recording every local processing step.",
    ];
    const names = [
      "Receiving capture",
      "Inspecting signal",
      "Detecting noise and compression",
      "Restoring detail",
      "Polishing dynamics",
      "Generating difference map",
      "Preparing report",
    ];
    for (let index = 0; index < names.length; index += 1) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, index === 0 ? 180 : 520),
      );
      setUpgradeEvents((current) => [
        ...current.map((event) =>
          event.status === "active"
            ? { ...event, status: "complete" as const }
            : event,
        ),
        {
          sequence: index,
          stage: names[index] ?? "Preparing report",
          detail: detail[index] ?? "",
          status: index === names.length - 1 ? "complete" : "active",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        },
      ]);
    }
    setUpgradeState("complete");
  }, []);

  const consumeUpgradeStream = useCallback(
    async (eventsUrl: string, upgradeId: string) => {
      const response = await fetch(eventsUrl, { cache: "no-store" });
      if (!response.ok || !response.body)
        throw new Error("The durable progress stream could not be opened.");
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += chunk.value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as UpgradeEvent;
          setUpgradeEvents((current) => [
            ...current.filter((item) => item.sequence !== event.sequence),
            event,
          ]);
        }
      }
      const statusResponse = await fetch(`/api/upgrades/${upgradeId}`, {
        cache: "no-store",
      });
      const status = (await statusResponse.json()) as {
        state: string;
        resultUrl?: string | null;
        error?: { message: string } | null;
      };
      if (status.state !== "completed" || !status.resultUrl)
        throw new Error(
          status.error?.message ?? "The deeper restoration did not finish.",
        );
      const audioResponse = await fetch(status.resultUrl);
      const resultBlob = await audioResponse.blob();
      const { decodeWav } = await import("@/lib/audio");
      const decoded = await decodeWav(resultBlob);
      const record = makeRecord(
        "A",
        decoded.samples,
        decoded.sampleRate,
        captureA?.deviceLabel ?? "Input A",
      );
      if (!replaceEnhanced(record)) return;
      setUpgradeState("complete");
    },
    [captureA?.deviceLabel, replaceEnhanced],
  );

  const beginUpgrade = useCallback(async () => {
    if (!captureA || !captureB) return;
    stopPlayback();
    setStage("Upgrade");
    setCurrentTime(0);
    setUpgradeEvents([]);
    setUpgradeState("running");
    setUpgradeError(undefined);
    const preview = createDspPreview(captureA.samples, captureA.sampleRate);
    const previewRecord = makeRecord(
      "A",
      preview.samples,
      preview.sampleRate,
      captureA.deviceLabel,
    );
    if (!replaceEnhanced(previewRecord)) return;
    if (SIGNAL_MODE === "demo") {
      void runDemoUpgrade();
      return;
    }
    try {
      const activeSession = sessionId ?? (await createSession());
      await Promise.all([
        uploadCapture(activeSession, captureA),
        uploadCapture(activeSession, captureB),
      ]);
      const response = await fetch("/api/upgrades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSession }),
      });
      const payload = (await response.json()) as {
        upgradeId?: string;
        eventsUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.upgradeId || !payload.eventsUrl)
        throw new Error(
          payload.error?.message ?? "The upgrade could not be started.",
        );
      await consumeUpgradeStream(payload.eventsUrl, payload.upgradeId);
    } catch (error) {
      setUpgradeError(displayError(error));
      setUpgradeState("failed");
    }
  }, [
    captureA,
    captureB,
    consumeUpgradeStream,
    createSession,
    runDemoUpgrade,
    replaceEnhanced,
    sessionId,
    stopPlayback,
    uploadCapture,
  ]);

  const resetExperiment = useCallback(() => {
    stopPlayback();
    releaseAllRecords();
    enhancedRef.current = null;
    setCaptureA(null);
    setCaptureB(null);
    setEnhanced(null);
    setSessionId(undefined);
    setCaptureProgress(0);
    setUpgradeEvents([]);
    setCurrentTime(0);
    setStage("Reference");
  }, [releaseAllRecords, stopPlayback]);

  const repeatCaptures = useCallback(() => {
    stopPlayback();
    releaseRecord(captureA);
    releaseRecord(captureB);
    releaseRecord(enhancedRef.current);
    enhancedRef.current = null;
    setCaptureA(null);
    setCaptureB(null);
    setEnhanced(null);
    setCurrentTime(0);
    setStage("Input A");
  }, [captureA, captureB, releaseRecord, stopPlayback]);

  const loadDemo = useCallback(() => {
    resetExperiment();
    const demo = makeDemoCaptures();
    const ownsA = ownRecord(demo.a);
    const ownsB = ownRecord(demo.b);
    if (!ownsA || !ownsB) {
      releaseRecord(demo.a);
      releaseRecord(demo.b);
      return;
    }
    setCaptureA(demo.a);
    setCaptureB(demo.b);
    setConfirmedA(true);
    setConfirmedB(true);
    setAboutOpen(false);
    setStage("Reveal");
  }, [ownRecord, releaseRecord, resetExperiment]);

  const playUpgradeComparison = useCallback(() => {
    if (!captureA || !enhanced) return;
    if (playing) {
      stopPlayback();
      return;
    }
    const next = playbackSelectionRef.current;
    playbackSelectionRef.current =
      next === "original" ? "enhanced" : "original";
    void playRecords([next === "original" ? captureA : enhanced]);
  }, [captureA, enhanced, playRecords, playing, stopPlayback]);

  const observations = useMemo(
    () => (captureA && captureB ? createObservations(captureA, captureB) : []),
    [captureA, captureB],
  );
  const selectedLabel = (slot: "A" | "B") => {
    const id = slot === "A" ? inputA : inputB;
    return (
      devices.find((device) => device.deviceId === id)?.label ?? `Input ${slot}`
    );
  };

  return (
    <div ref={appShellRef} className="app-shell">
      <header className="site-header">
        <Link
          className="brand-button"
          href="/"
          aria-label="Signal Enhancer home"
        >
          <SignalMark />
          <span>Signal Enhancer</span>
        </Link>
        <button
          className="about-button"
          type="button"
          aria-label="About Signal Enhancer"
          onClick={(event) => {
            event.currentTarget.focus();
            setAboutOpen(true);
          }}
        >
          <span>About</span>
          <Menu size={22} />
        </button>
      </header>
      <main>
        <ExperimentStepper stage={stage} />
        {stage === "Reference" ? (
          <ReferenceStage
            devices={devices}
            inputA={inputA}
            inputB={inputB}
            confirmedA={confirmedA}
            confirmedB={confirmedB}
            permissionState={permissionState}
            permissionMessage={permissionMessage}
            playing={playing}
            currentTime={currentTime}
            onInputA={(id) => {
              setInputA(id);
              setConfirmedA(false);
            }}
            onInputB={(id) => {
              setInputB(id);
              setConfirmedB(false);
            }}
            onConfirmA={() => setConfirmedA(true)}
            onConfirmB={() => setConfirmedB(true)}
            onRequestPermission={() => void requestPermission()}
            onToggleReference={() => void toggleReference()}
            onSeekReference={seekReference}
            onBegin={() => void beginInputA()}
          />
        ) : null}
        {stage === "Input A" ? (
          <CaptureStage
            slot="A"
            deviceLabel={selectedLabel("A")}
            recording={recording}
            progress={captureProgress}
            error={captureError}
            onStart={() => void startCapture("A")}
            onCancel={cancelCapture}
          />
        ) : null}
        {stage === "Input B" ? (
          <CaptureStage
            slot="B"
            deviceLabel={selectedLabel("B")}
            recording={recording}
            progress={captureProgress}
            error={captureError}
            onStart={() => void startCapture("B")}
            onCancel={cancelCapture}
          />
        ) : null}
        {stage === "Reveal" && captureA && captureB ? (
          <RevealStage
            captureA={captureA}
            captureB={captureB}
            observations={observations}
            playing={playing}
            currentTime={currentTime}
            signalMode={SIGNAL_MODE}
            onPlay={handleRevealPlay}
            onSeek={seekCapture}
            onRepeat={repeatCaptures}
            onUpgrade={() => void beginUpgrade()}
          />
        ) : null}
        {stage === "Upgrade" && captureA ? (
          <UpgradeStage
            source={captureA}
            enhanced={enhanced}
            events={upgradeEvents}
            state={upgradeState}
            mode={SIGNAL_MODE}
            playing={playing}
            currentTime={currentTime}
            error={upgradeError}
            onTogglePlayback={playUpgradeComparison}
            onSeek={seekCapture}
            onCancel={resetExperiment}
            onReset={resetExperiment}
          />
        ) : null}
      </main>
      <footer className="site-footer">
        <span>Input Chain Fingerprint · v1</span>
        <span>Private by default · Evidence without ranking</span>
      </footer>
      <AboutDialog
        open={aboutOpen}
        demoAvailable={SIGNAL_MODE === "demo"}
        onClose={() => setAboutOpen(false)}
        onLoadDemo={loadDemo}
      />
    </div>
  );
}
