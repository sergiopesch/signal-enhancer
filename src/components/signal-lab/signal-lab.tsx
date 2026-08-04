"use client";

import { Menu } from "lucide-react";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  MotionConfig,
  useIsPresent,
} from "motion/react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { LabAtmosphere } from "@/components/immersive/lab-atmosphere";
import {
  analyzeAudio,
  capturePcmWav,
  createDspPreview,
  encodeWav,
  listAudioInputs,
  requestAudioPermission,
  stopMediaStream,
  type AudioAnalysis,
} from "@/lib/audio";
import { requestRemoteUpgradeCancellation } from "@/lib/client/upgrade-cancellation";
import { followUpgradeProgress } from "@/lib/client/upgrade-progress";
import {
  GUIDED_READING_COUNT_IN_SECONDS,
  GUIDED_READING_DURATION_SECONDS,
  GUIDED_READING_ID,
  isCompleteGuidedReadingDuration,
} from "@/lib/audio/reading-passage";

import { AboutDialog } from "./about-dialog";
import { CaptureStage, type CapturePhase } from "./capture-stage";
import { ExperimentStepper, type ExperimentStage } from "./experiment-stepper";
import { ReferenceStage } from "./reference-stage";
import { RevealStage } from "./reveal-stage";
import { SignalMark } from "./signal-mark";
import type {
  CaptureMetrics,
  CaptureRecord,
  DeviceChoice,
  UpgradeEvent,
  UpgradeProvenance,
} from "./types";
import { UpgradeStage } from "./upgrade-stage";

const SIGNAL_MODE =
  process.env.NEXT_PUBLIC_SIGNAL_MODE === "live" ? "live" : "demo";
const CAPTURE_SECONDS = GUIDED_READING_DURATION_SECONDS;
const UPGRADE_START_TIMEOUT_MS = 30_000;

const LAB_STAGE_VARIANTS = {
  enter: { opacity: 0, scale: 0.992, y: 18 },
  active: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.52, ease: [0.2, 0.72, 0.2, 1] },
    y: 0,
  },
  exit: {
    opacity: 0,
    scale: 0.996,
    transition: { duration: 0.24, ease: [0.4, 0, 1, 1] },
    y: -8,
  },
} as const;

type PlaybackTarget = "capture-A" | "capture-B" | "original" | "enhanced";

type PlaybackGroup = {
  source: AudioBufferSourceNode;
  startedAt: number;
  offset: number;
};

type LabSceneProps = {
  children: ReactNode;
  onMount: (node: HTMLDivElement | null) => void;
  sceneKey: string;
};

function LabScene({ children, onMount, sceneKey }: LabSceneProps) {
  const isPresent = useIsPresent();

  return (
    <m.div
      ref={onMount}
      data-scene-key={sceneKey}
      data-scene-presence={isPresent ? "active" : "exiting"}
      aria-hidden={isPresent ? undefined : true}
      inert={!isPresent}
      initial="enter"
      animate="active"
      exit="exit"
      variants={LAB_STAGE_VARIANTS}
      style={{
        pointerEvents: isPresent ? "auto" : "none",
        width: "100%",
      }}
    >
      {children}
    </m.div>
  );
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Capture cancelled.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    function handleAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("Capture cancelled.", "AbortError"));
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function displayError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The audio device did not complete that action.";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readUpgradeProvenance(
  routingValue: unknown,
  metadataValue: unknown,
): UpgradeProvenance {
  const routing = recordValue(routingValue);
  const metadata = recordValue(metadataValue);
  const versions = recordValue(metadata?.versions);
  if (
    routing?.used_engine !== "resemble" ||
    routing.outcome !== "enhanced" ||
    versions?.model_name !== "resemble-enhance" ||
    typeof versions.model_repository !== "string" ||
    typeof versions.model_revision !== "string" ||
    typeof versions.model_checkpoint_sha256 !== "string" ||
    typeof versions.source_revision !== "string" ||
    typeof versions.pipeline_revision !== "string" ||
    typeof versions.inference_profile !== "string"
  ) {
    throw new Error(
      "The protected worker did not return a verified AI restoration receipt.",
    );
  }
  return {
    engine: "resemble",
    modelName: "resemble-enhance",
    modelRepository: versions.model_repository,
    modelRevision: versions.model_revision,
    checkpointSha256: versions.model_checkpoint_sha256,
    sourceRevision: versions.source_revision,
    pipelineRevision: versions.pipeline_revision,
    inferenceProfile: versions.inference_profile,
  };
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
    protocolId: GUIDED_READING_ID,
    blob,
    url: URL.createObjectURL(blob),
    samples,
    sampleRate,
    waveform: waveformValues(analysis),
    spectrum: analysis.spectrum.map((bin) => bin.magnitudeDbFs),
    spectrumFrequenciesHz: analysis.spectrum.map((bin) => bin.frequencyHz),
    dynamics: analysis.dynamics.map((bin) => bin.rmsDbFs),
    metrics: toMetrics(analysis),
    deviceLabel,
  };
}

function makeDemoCaptures() {
  const sampleRate = 48_000;
  const source = new Float32Array(sampleRate * CAPTURE_SECONDS);
  const a = new Float32Array(source.length);
  const b = new Float32Array(source.length);
  let smooth = 0;
  let seed = 0x13579bdf;
  for (let index = 0; index < source.length; index += 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const noise = (seed / 4_294_967_296) * 2 - 1;
    const time = index / sampleRate;
    const isRoomTone = time < 2;
    const cueStart = time < 8 ? 2 : time < 14 ? 8 : 14;
    const cueEnd = time < 8 ? 8 : time < 14 ? 14 : 20;
    const cueEnvelope = isRoomTone
      ? 0
      : Math.min(1, (time - cueStart) * 5, (cueEnd - time) * 5);
    const syllable = isRoomTone
      ? 0
      : 0.18 +
        0.82 * Math.pow(Math.max(0, Math.sin(time * Math.PI * 3.4)), 0.7);
    const delivery = time >= 8 && time < 14 ? 0.28 : 0.52;
    const fundamental = 118 + 9 * Math.sin(time * 1.7);
    const voiced =
      Math.sin(2 * Math.PI * fundamental * time) * 0.62 +
      Math.sin(2 * Math.PI * fundamental * 2.03 * time) * 0.24 +
      Math.sin(2 * Math.PI * fundamental * 3.97 * time) * 0.1;
    const sample =
      noise * 0.0025 +
      cueEnvelope * syllable * delivery * (voiced + noise * 0.12);
    source[index] = sample;
    smooth += 0.16 * (sample - smooth);
    a[index] = Math.max(-0.98, Math.min(0.98, smooth * 1.07 + noise * 0.012));
    b[index] = Math.tanh((sample + noise * 0.004) * 1.45) * 0.72;
  }
  return {
    a: makeRecord("A", a, sampleRate, "Laptop microphone · demonstration"),
    b: makeRecord("B", b, sampleRate, "Wireless headset · demonstration"),
  };
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
  const [capturePhase, setCapturePhase] = useState<CapturePhase>("idle");
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureElapsed, setCaptureElapsed] = useState(0);
  const [captureCountdown, setCaptureCountdown] = useState(
    GUIDED_READING_COUNT_IN_SECONDS,
  );
  const [captureError, setCaptureError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [activePlaybackTarget, setActivePlaybackTarget] =
    useState<PlaybackTarget | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [sessionId, setSessionId] = useState<string>();
  const [enhanced, setEnhanced] = useState<CaptureRecord | null>(null);
  const [upgradeState, setUpgradeState] = useState<
    "running" | "complete" | "failed"
  >("running");
  const [upgradeEvents, setUpgradeEvents] = useState<UpgradeEvent[]>([]);
  const [upgradeError, setUpgradeError] = useState<string>();
  const [upgradeProvenance, setUpgradeProvenance] =
    useState<UpgradeProvenance | null>(null);

  const appShellRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<PlaybackGroup | null>(null);
  const playbackSequenceRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const captureSequenceRef = useRef(0);
  const captureAbortRef = useRef<AbortController | null>(null);
  const upgradeSequenceRef = useRef(0);
  const upgradeAbortRef = useRef<AbortController | null>(null);
  const upgradeIdRef = useRef<string | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const playbackSelectionRef = useRef<"original" | "enhanced">("enhanced");
  const enhancedRef = useRef<CaptureRecord | null>(null);
  const mountedRef = useRef(true);
  const previousSceneRef = useRef(
    stage === "Upgrade" ? `${stage}-${upgradeState}` : stage,
  );
  const previousCapturePhaseRef = useRef<CapturePhase>(capturePhase);
  const sceneFocusFrameRef = useRef<number | null>(null);
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

  const sceneKey = stage === "Upgrade" ? `${stage}-${upgradeState}` : stage;

  const focusSceneOnMount = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const mountedSceneKey = node.dataset.sceneKey;
    if (!mountedSceneKey || previousSceneRef.current === mountedSceneKey)
      return;
    previousSceneRef.current = mountedSceneKey;
    if (sceneFocusFrameRef.current !== null)
      window.cancelAnimationFrame(sceneFocusFrameRef.current);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    sceneFocusFrameRef.current = window.requestAnimationFrame(() => {
      sceneFocusFrameRef.current = null;
      if (!node.isConnected) return;
      node
        .querySelector<HTMLElement>(".stage h1, .fault-inline h1")
        ?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    const previousPhase = previousCapturePhaseRef.current;
    previousCapturePhaseRef.current = capturePhase;
    if (previousPhase === "complete" || capturePhase !== "complete") return;
    const frame = window.requestAnimationFrame(() => {
      appShellRef.current
        ?.querySelector<HTMLButtonElement>(".capture-review-actions button")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [capturePhase]);

  const ensureAudioContext = useCallback(() => {
    audioContextRef.current ??= new AudioContext({
      sampleRate: 48_000,
      latencyHint: "interactive",
    });
    return audioContextRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    playbackSequenceRef.current += 1;
    if (playbackRef.current) {
      try {
        playbackRef.current.source.stop();
      } catch {
        /* already stopped */
      }
    }
    playbackRef.current = null;
    if (animationRef.current !== null)
      cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setPlaying(false);
    setActivePlaybackTarget(null);
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
      if (sceneFocusFrameRef.current !== null)
        window.cancelAnimationFrame(sceneFocusFrameRef.current);
      const activeUpgradeId = upgradeIdRef.current;
      if (SIGNAL_MODE === "live" && activeUpgradeId) {
        requestRemoteUpgradeCancellation(activeUpgradeId);
      }
      upgradeIdRef.current = null;
      stopPlayback();
      captureSequenceRef.current += 1;
      upgradeSequenceRef.current += 1;
      captureAbortRef.current?.abort();
      upgradeAbortRef.current?.abort();
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

  const createSession = useCallback(
    async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (sessionId) return sessionId;
      const byId = (id: string) =>
        devices.find((device) => device.deviceId === id)?.label ??
        "Browser audio input";
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceId: GUIDED_READING_ID,
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
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error?.message ??
            "The experiment session could not be started.",
        );
      const payload = (await response.json()) as { sessionId: string };
      signal?.throwIfAborted();
      setSessionId(payload.sessionId);
      return payload.sessionId;
    },
    [devices, inputA, inputB, sessionId],
  );

  const beginInputA = useCallback(async () => {
    setCaptureError(undefined);
    try {
      await createSession();
      stopPlayback();
      setCurrentTime(0);
      setCaptureProgress(0);
      setCaptureElapsed(0);
      setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
      setCapturePhase("idle");
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
      setCapturePhase("arming");
      setCaptureProgress(0);
      setCaptureElapsed(0);
      setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
      setCaptureError(undefined);
      stopPlayback();
      const captureSequence = captureSequenceRef.current + 1;
      captureSequenceRef.current = captureSequence;
      const abortController = new AbortController();
      captureAbortRef.current = abortController;
      let stream: MediaStream | null = null;
      const isCurrentCapture = () =>
        captureSequenceRef.current === captureSequence;
      try {
        stream = await requestAudioPermission(deviceId);
        if (abortController.signal.aborted || !isCurrentCapture()) {
          stopMediaStream(stream);
          return;
        }
        activeStreamRef.current = stream;
        const context = ensureAudioContext();
        if (context.state === "suspended") await context.resume();
        if (abortController.signal.aborted || !isCurrentCapture()) return;
        setCapturePhase("countdown");
        for (
          let remaining = GUIDED_READING_COUNT_IN_SECONDS;
          remaining > 0;
          remaining -= 1
        ) {
          setCaptureCountdown(remaining);
          await abortableDelay(1_000, abortController.signal);
        }
        setCaptureCountdown(0);
        const capturePromise = capturePcmWav({
          stream,
          deviceId,
          durationMs: CAPTURE_SECONDS * 1_000,
          audioContext: context,
          signal: abortController.signal,
          onReady: () => {
            if (isCurrentCapture()) setCapturePhase("capturing");
          },
          onProgress: (progress) => {
            if (!isCurrentCapture()) return;
            setCaptureProgress(progress.ratio);
            setCaptureElapsed(progress.elapsedMs / 1_000);
          },
        });
        const result = await capturePromise;
        if (abortController.signal.aborted || !isCurrentCapture()) return;
        stopMediaStream(stream);
        if (activeStreamRef.current === stream) activeStreamRef.current = null;
        const capturedDuration = result.samples.length / result.sampleRate;
        if (!isCompleteGuidedReadingDuration(capturedDuration)) {
          throw new Error(
            "The input ended before the complete 20-second reading was captured. Please record this input again.",
          );
        }
        setCapturePhase("analyzing");
        await abortableDelay(0, abortController.signal);
        if (abortController.signal.aborted || !isCurrentCapture()) return;
        const analysis = analyzeAudio(result.samples, result.sampleRate, {
          waveformBins: 620,
          spectrumBins: 120,
          dynamicsBins: 160,
        });
        const record: CaptureRecord = {
          slot,
          protocolId: GUIDED_READING_ID,
          blob: result.wav,
          url: URL.createObjectURL(result.wav),
          samples: result.samples,
          sampleRate: result.sampleRate,
          waveform: waveformValues(analysis),
          spectrum: analysis.spectrum.map((bin) => bin.magnitudeDbFs),
          spectrumFrequenciesHz: analysis.spectrum.map(
            (bin) => bin.frequencyHz,
          ),
          dynamics: analysis.dynamics.map((bin) => bin.rmsDbFs),
          metrics: toMetrics(analysis),
          deviceLabel,
        };
        if (!ownRecord(record)) return;
        if (slot === "A") {
          releaseRecord(captureA);
          setCaptureA(record);
        } else {
          releaseRecord(captureB);
          setCaptureB(record);
        }
        setCaptureProgress(1);
        setCaptureElapsed(Math.min(CAPTURE_SECONDS, capturedDuration));
        setCapturePhase("complete");
        setCurrentTime(0);
      } catch (error) {
        if (!isCurrentCapture()) return;
        if (abortController.signal.aborted) {
          setCapturePhase("idle");
        } else {
          setCaptureError(displayError(error));
          setCapturePhase("error");
        }
      } finally {
        if (stream) stopMediaStream(stream);
        if (activeStreamRef.current === stream) activeStreamRef.current = null;
        if (captureAbortRef.current === abortController)
          captureAbortRef.current = null;
      }
    },
    [
      captureA,
      captureB,
      devices,
      ensureAudioContext,
      inputA,
      inputB,
      ownRecord,
      releaseRecord,
      stopPlayback,
    ],
  );

  const cancelCapture = useCallback(() => {
    captureSequenceRef.current += 1;
    captureAbortRef.current?.abort();
    captureAbortRef.current = null;
    if (activeStreamRef.current) stopMediaStream(activeStreamRef.current);
    activeStreamRef.current = null;
    setCapturePhase("idle");
    setCaptureProgress(0);
    setCaptureElapsed(0);
    setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
  }, []);

  const playRecord = useCallback(
    async (
      record: CaptureRecord,
      target: PlaybackTarget,
      offset = currentTime,
    ) => {
      stopPlayback();
      const requestSequence = playbackSequenceRef.current;
      const context = ensureAudioContext();
      if (context.state === "suspended") await context.resume();
      if (playbackSequenceRef.current !== requestSequence) return;
      const startAt = context.currentTime + 0.04;
      const buffer = context.createBuffer(
        1,
        record.samples.length,
        record.sampleRate,
      );
      buffer.copyToChannel(new Float32Array(record.samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const safeOffset =
        offset >= buffer.duration
          ? 0
          : Math.max(0, Math.min(offset, buffer.duration));
      source.start(startAt, safeOffset);
      const sequence = requestSequence + 1;
      playbackSequenceRef.current = sequence;
      playbackRef.current = { source, startedAt: startAt, offset: safeOffset };
      setActivePlaybackTarget(target);
      setPlaying(true);
      trackPlayback(startAt, safeOffset, context);
      source.onended = () => {
        if (playbackSequenceRef.current !== sequence) return;
        playbackRef.current = null;
        setPlaying(false);
        setActivePlaybackTarget(null);
      };
    },
    [currentTime, ensureAudioContext, stopPlayback, trackPlayback],
  );

  const handleRevealPlay = useCallback(
    (slot: "A" | "B") => {
      if (!captureA || !captureB) return;
      const target = `capture-${slot}` as const;
      if (playing && activePlaybackTarget === target) {
        stopPlayback();
        return;
      }
      void playRecord(slot === "A" ? captureA : captureB, target);
    },
    [
      activePlaybackTarget,
      captureA,
      captureB,
      playRecord,
      playing,
      stopPlayback,
    ],
  );

  const handleRevealSelect = useCallback(() => {
    stopPlayback();
    setCurrentTime(0);
  }, [stopPlayback]);

  const continueAfterCapture = useCallback(
    (slot: "A" | "B") => {
      stopPlayback();
      setCurrentTime(0);
      setCaptureProgress(0);
      setCaptureElapsed(0);
      setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
      setCapturePhase("idle");
      setCaptureError(undefined);
      setStage(slot === "A" ? "Input B" : "Reveal");
    },
    [stopPlayback],
  );

  const retakeCapture = useCallback(
    (slot: "A" | "B") => {
      stopPlayback();
      const record = slot === "A" ? captureA : captureB;
      releaseRecord(record);
      if (slot === "A") setCaptureA(null);
      else setCaptureB(null);
      setCurrentTime(0);
      setCaptureProgress(0);
      setCaptureElapsed(0);
      setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
      setCapturePhase("idle");
      setCaptureError(undefined);
    },
    [captureA, captureB, releaseRecord, stopPlayback],
  );

  const toggleCaptureReview = useCallback(
    (slot: "A" | "B") => {
      const record = slot === "A" ? captureA : captureB;
      if (!record) return;
      const target: PlaybackTarget = `capture-${slot}`;
      if (playing && activePlaybackTarget === target) {
        stopPlayback();
        return;
      }
      void playRecord(record, target);
    },
    [
      activePlaybackTarget,
      captureA,
      captureB,
      playRecord,
      playing,
      stopPlayback,
    ],
  );

  const seekCapture = useCallback(
    (time: number) => {
      stopPlayback();
      setCurrentTime(Math.max(0, Math.min(CAPTURE_SECONDS, time)));
    },
    [stopPlayback],
  );

  const uploadCapture = useCallback(
    async (session: string, record: CaptureRecord, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const captureSha256 = await sha256(record.blob);
      signal?.throwIfAborted();
      const authorize = await fetch("/api/sessions/uploads/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session,
          slot: record.slot,
          bytes: record.blob.size,
          sha256: captureSha256,
        }),
        ...(signal ? { signal } : {}),
      });
      if (!authorize.ok)
        throw new Error(
          (await authorize.json().catch(() => null))?.error?.message ??
            "Private upload could not be authorized.",
        );
      signal?.throwIfAborted();
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
        ...(signal ? { signal } : {}),
      });
      if (!uploaded.ok && uploaded.status !== 409)
        throw new Error("The capture could not be placed in private storage.");
      signal?.throwIfAborted();
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
        ...(signal ? { signal } : {}),
      });
      if (!committed.ok)
        throw new Error(
          (await committed.json().catch(() => null))?.error?.message ??
            "The capture upload could not be verified.",
        );
      signal?.throwIfAborted();
    },
    [],
  );

  const runDemoUpgrade = useCallback(
    async (signal: AbortSignal, isCurrent: () => boolean) => {
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
        await abortableDelay(index === 0 ? 180 : 520, signal);
        signal.throwIfAborted();
        if (!isCurrent())
          throw new DOMException("Upgrade cancelled.", "AbortError");
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
      signal.throwIfAborted();
      if (!isCurrent())
        throw new DOMException("Upgrade cancelled.", "AbortError");
      setUpgradeState("complete");
    },
    [],
  );

  const consumeUpgradeStream = useCallback(
    async (
      eventsUrl: string,
      upgradeId: string,
      abortController: AbortController,
      upgradeSequence: number,
    ) => {
      const assertCurrent = () => {
        abortController.signal.throwIfAborted();
        if (
          !mountedRef.current ||
          upgradeSequenceRef.current !== upgradeSequence ||
          upgradeAbortRef.current !== abortController
        ) {
          throw new DOMException("Upgrade cancelled.", "AbortError");
        }
      };
      assertCurrent();
      const status = await followUpgradeProgress({
        eventsUrl,
        statusUrl: `/api/upgrades/${upgradeId}`,
        signal: abortController.signal,
        onEvent: (event) => {
          assertCurrent();
          setUpgradeEvents((current) => [
            ...current.filter((item) => item.sequence !== event.sequence),
            event,
          ]);
        },
      });
      assertCurrent();
      if (!status.resultUrl)
        throw new Error("The deeper restoration returned no result.");
      const provenance = readUpgradeProvenance(
        status.routing,
        status.resultMetadata,
      );
      const audioResponse = await fetch(status.resultUrl, {
        signal: abortController.signal,
      });
      assertCurrent();
      const resultBlob = await audioResponse.blob();
      assertCurrent();
      if (
        !status.resultSha256 ||
        (await sha256(resultBlob)) !== status.resultSha256
      ) {
        throw new Error("The enhanced WAV failed its integrity check.");
      }
      assertCurrent();
      const { decodeWav } = await import("@/lib/audio");
      assertCurrent();
      const decoded = await decodeWav(resultBlob);
      assertCurrent();
      const record = makeRecord(
        "A",
        decoded.samples,
        decoded.sampleRate,
        captureA?.deviceLabel ?? "Input A",
      );
      if (!replaceEnhanced(record)) return;
      setUpgradeProvenance(provenance);
      setUpgradeState("complete");
      upgradeIdRef.current = null;
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
    setUpgradeProvenance(null);
    upgradeIdRef.current = null;
    upgradeAbortRef.current?.abort();
    const upgradeSequence = upgradeSequenceRef.current + 1;
    upgradeSequenceRef.current = upgradeSequence;
    const abortController = new AbortController();
    upgradeAbortRef.current = abortController;
    const isCurrentUpgrade = () =>
      mountedRef.current &&
      upgradeSequenceRef.current === upgradeSequence &&
      upgradeAbortRef.current === abortController &&
      !abortController.signal.aborted;
    const assertCurrentUpgrade = () => {
      abortController.signal.throwIfAborted();
      if (!isCurrentUpgrade())
        throw new DOMException("Upgrade cancelled.", "AbortError");
    };
    const preview = createDspPreview(captureA.samples, captureA.sampleRate);
    const previewRecord = makeRecord(
      "A",
      preview.samples,
      preview.sampleRate,
      captureA.deviceLabel,
    );
    if (!replaceEnhanced(previewRecord)) {
      abortController.abort();
      if (upgradeAbortRef.current === abortController)
        upgradeAbortRef.current = null;
      return;
    }
    let requestedUpgradeId: string | null = null;
    try {
      if (SIGNAL_MODE === "demo") {
        await runDemoUpgrade(abortController.signal, isCurrentUpgrade);
        return;
      }
      const activeSession =
        sessionId ?? (await createSession(abortController.signal));
      assertCurrentUpgrade();
      await Promise.all([
        uploadCapture(activeSession, captureA, abortController.signal),
        uploadCapture(activeSession, captureB, abortController.signal),
      ]);
      assertCurrentUpgrade();
      requestedUpgradeId = crypto.randomUUID();
      upgradeIdRef.current = requestedUpgradeId;
      const response = await fetch("/api/upgrades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession,
          upgradeId: requestedUpgradeId,
        }),
        // This bounded request deliberately outlives a UI reset. If the server
        // accepted the job, its client-known ID can still be cancelled.
        signal: AbortSignal.timeout(UPGRADE_START_TIMEOUT_MS),
      });
      const payload = (await response.json()) as {
        upgradeId?: string;
        eventsUrl?: string;
        error?: { message?: string };
      };
      if (!isCurrentUpgrade()) {
        requestRemoteUpgradeCancellation(requestedUpgradeId);
        throw new DOMException("Upgrade cancelled.", "AbortError");
      }
      if (
        !response.ok ||
        payload.upgradeId !== requestedUpgradeId ||
        !payload.eventsUrl
      )
        throw new Error(
          payload.error?.message ?? "The upgrade could not be started.",
        );
      abortController.signal.throwIfAborted();
      await consumeUpgradeStream(
        payload.eventsUrl,
        requestedUpgradeId,
        abortController,
        upgradeSequence,
      );
    } catch (error) {
      const activeUpgradeId = requestedUpgradeId ?? upgradeIdRef.current;
      if (SIGNAL_MODE === "live" && activeUpgradeId)
        requestRemoteUpgradeCancellation(activeUpgradeId);
      if (upgradeIdRef.current === activeUpgradeId) upgradeIdRef.current = null;
      if (isAbortError(error) || !isCurrentUpgrade()) return;
      setUpgradeError(displayError(error));
      setUpgradeState("failed");
    } finally {
      if (upgradeAbortRef.current === abortController)
        upgradeAbortRef.current = null;
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
    upgradeSequenceRef.current += 1;
    upgradeAbortRef.current?.abort();
    upgradeAbortRef.current = null;
    upgradeIdRef.current = null;
    stopPlayback();
    releaseAllRecords();
    enhancedRef.current = null;
    setCaptureA(null);
    setCaptureB(null);
    setEnhanced(null);
    setSessionId(undefined);
    setCaptureProgress(0);
    setCaptureElapsed(0);
    setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
    setCapturePhase("idle");
    setCaptureError(undefined);
    setUpgradeEvents([]);
    setUpgradeProvenance(null);
    setCurrentTime(0);
    setStage("Reference");
  }, [releaseAllRecords, stopPlayback]);

  const cancelUpgrade = useCallback(() => {
    const upgradeId = upgradeIdRef.current;
    upgradeAbortRef.current?.abort();
    if (SIGNAL_MODE === "live" && upgradeId) {
      requestRemoteUpgradeCancellation(upgradeId);
    }
    resetExperiment();
  }, [resetExperiment]);

  const repeatCaptures = useCallback(() => {
    const activeUpgradeId = upgradeIdRef.current;
    upgradeSequenceRef.current += 1;
    upgradeAbortRef.current?.abort();
    upgradeAbortRef.current = null;
    upgradeIdRef.current = null;
    if (SIGNAL_MODE === "live" && activeUpgradeId)
      requestRemoteUpgradeCancellation(activeUpgradeId);
    stopPlayback();
    releaseRecord(captureA);
    releaseRecord(captureB);
    releaseRecord(enhancedRef.current);
    enhancedRef.current = null;
    setCaptureA(null);
    setCaptureB(null);
    setEnhanced(null);
    setCurrentTime(0);
    setCaptureProgress(0);
    setCaptureElapsed(0);
    setCaptureCountdown(GUIDED_READING_COUNT_IN_SECONDS);
    setCapturePhase("idle");
    setCaptureError(undefined);
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
    void playRecord(
      next === "original" ? captureA : enhanced,
      next === "original" ? "original" : "enhanced",
    );
  }, [captureA, enhanced, playRecord, playing, stopPlayback]);

  const alternateUpgradeComparison = useCallback(() => {
    if (!captureA || !enhanced) return;
    const next =
      playing && activePlaybackTarget === "original"
        ? "enhanced"
        : playing && activePlaybackTarget === "enhanced"
          ? "original"
          : playbackSelectionRef.current;
    playbackSelectionRef.current =
      next === "original" ? "enhanced" : "original";
    void playRecord(
      next === "original" ? captureA : enhanced,
      next === "original" ? "original" : "enhanced",
    );
  }, [activePlaybackTarget, captureA, enhanced, playRecord, playing]);

  const selectedLabel = (slot: "A" | "B") => {
    const id = slot === "A" ? inputA : inputB;
    return (
      devices.find((device) => device.deviceId === id)?.label ?? `Input ${slot}`
    );
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div
          ref={appShellRef}
          className="app-shell"
          style={{ isolation: "isolate", position: "relative" }}
        >
          <LabAtmosphere stage={stage} />
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
            <AnimatePresence initial={false} mode="wait">
              <LabScene
                key={sceneKey}
                sceneKey={sceneKey}
                onMount={focusSceneOnMount}
              >
                {stage === "Reference" ? (
                  <ReferenceStage
                    devices={devices}
                    inputA={inputA}
                    inputB={inputB}
                    confirmedA={confirmedA}
                    confirmedB={confirmedB}
                    permissionState={permissionState}
                    permissionMessage={permissionMessage}
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
                    onBegin={() => void beginInputA()}
                  />
                ) : null}
                {stage === "Input A" ? (
                  <CaptureStage
                    slot="A"
                    deviceLabel={selectedLabel("A")}
                    phase={capturePhase}
                    progress={captureProgress}
                    elapsedSeconds={captureElapsed}
                    countdownSeconds={captureCountdown}
                    error={captureError}
                    reviewPlaying={
                      playing && activePlaybackTarget === "capture-A"
                    }
                    onStart={() => void startCapture("A")}
                    onCancel={cancelCapture}
                    onContinue={() => continueAfterCapture("A")}
                    onRetake={() => retakeCapture("A")}
                    onToggleReview={() => toggleCaptureReview("A")}
                  />
                ) : null}
                {stage === "Input B" ? (
                  <CaptureStage
                    slot="B"
                    deviceLabel={selectedLabel("B")}
                    phase={capturePhase}
                    progress={captureProgress}
                    elapsedSeconds={captureElapsed}
                    countdownSeconds={captureCountdown}
                    error={captureError}
                    reviewPlaying={
                      playing && activePlaybackTarget === "capture-B"
                    }
                    onStart={() => void startCapture("B")}
                    onCancel={cancelCapture}
                    onContinue={() => continueAfterCapture("B")}
                    onRetake={() => retakeCapture("B")}
                    onToggleReview={() => toggleCaptureReview("B")}
                  />
                ) : null}
                {stage === "Reveal" && captureA && captureB ? (
                  <RevealStage
                    captureA={captureA}
                    captureB={captureB}
                    playing={playing}
                    activeTrack={
                      activePlaybackTarget === "capture-A"
                        ? "A"
                        : activePlaybackTarget === "capture-B"
                          ? "B"
                          : null
                    }
                    currentTime={currentTime}
                    signalMode={SIGNAL_MODE}
                    onSelect={handleRevealSelect}
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
                    provenance={upgradeProvenance}
                    playing={playing}
                    currentTime={currentTime}
                    error={upgradeError}
                    onAlternatePlayback={alternateUpgradeComparison}
                    onTogglePlayback={playUpgradeComparison}
                    onSeek={seekCapture}
                    onCancel={cancelUpgrade}
                    onReset={resetExperiment}
                  />
                ) : null}
              </LabScene>
            </AnimatePresence>
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
      </MotionConfig>
    </LazyMotion>
  );
}
