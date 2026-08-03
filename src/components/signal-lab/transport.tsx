"use client";

import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";

type TransportProps = {
  playing: boolean;
  currentTime: number;
  duration?: number;
  onToggle: () => void;
  onSeek?: (time: number) => void;
  label?: string;
  compact?: boolean;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00.0";
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${remainder}`;
}

export function Transport({
  playing,
  currentTime,
  duration = 20,
  onToggle,
  onSeek,
  label = "selected capture",
  compact = false,
}: Readonly<TransportProps>) {
  return (
    <div className="transport" data-compact={compact || undefined}>
      <div className="transport-volume" aria-hidden="true">
        <Volume2 size={20} />
        <span className="volume-rail">
          <i />
        </span>
      </div>
      <div className="transport-center">
        <button
          type="button"
          className="transport-skip"
          aria-label="Return to start"
          onClick={() => onSeek?.(0)}
        >
          <SkipBack size={19} />
        </button>
        <button
          type="button"
          className="transport-primary"
          aria-label={`${playing ? "Pause" : "Play"} ${label}`}
          onClick={onToggle}
        >
          {playing ? (
            <Pause size={23} />
          ) : (
            <Play size={23} fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          className="transport-skip"
          aria-label="Skip to end"
          onClick={() => onSeek?.(duration)}
        >
          <SkipForward size={19} />
        </button>
      </div>
      <time
        className="transport-time"
        aria-label="Playback time"
        dateTime={`PT${Math.max(0, currentTime).toFixed(1)}S`}
      >
        {formatTime(currentTime)} <span>/</span> {formatTime(duration)}
      </time>
    </div>
  );
}
