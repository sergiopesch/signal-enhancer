"use client";

import { useId, useMemo } from "react";

export type PlotView = "waveform" | "spectrum" | "dynamics" | "difference";

export type PlotSegment = {
  label: string;
  startSeconds: number;
  endSeconds: number;
  range?: string;
  mobileLabel?: string;
};

export type PlotTrack = {
  id: string;
  label: string;
  color: "cyan" | "amber" | "neutral";
  samples?: readonly number[] | Float32Array;
  spectrum?: readonly number[] | Float32Array;
  spectrumFrequenciesHz?: readonly number[] | Float32Array;
  /** RMS envelope values in dBFS, where zero is full scale. */
  dynamics?: readonly number[] | Float32Array;
};

type SignalPlotProps = {
  tracks: readonly PlotTrack[];
  view?: PlotView;
  playhead?: number;
  compact?: boolean;
  showSegments?: boolean;
  segments?: readonly PlotSegment[];
  duration?: number;
  activeGate?: number | null;
  ariaLabel: string;
};

const NO_PLOT_SEGMENTS: readonly PlotSegment[] = [];

type SpectrumDomain = {
  minimumHz: number;
  maximumHz: number;
};

type RenderedTrack = PlotTrack & {
  baseline: number;
  hasData: boolean;
  path: string;
};

const DESKTOP_TIME_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;
const MOBILE_TIME_TICKS = [0, 0.5, 1] as const;
const PLOT_DB_FLOOR = -120;

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeSamples(
  samples: readonly number[] | Float32Array,
  target = 620,
) {
  if (samples.length === 0) return [];
  if (samples.length <= target) return Array.from(samples);
  const bucket = samples.length / target;
  return Array.from({ length: target }, (_, index) => {
    const start = Math.floor(index * bucket);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucket));
    let peak = Number.NaN;
    for (
      let cursor = start;
      cursor < end && cursor < samples.length;
      cursor += 1
    ) {
      const value = samples[cursor] ?? 0;
      if (
        Number.isFinite(value) &&
        (!Number.isFinite(peak) || Math.abs(value) > Math.abs(peak))
      )
        peak = value;
    }
    return peak;
  });
}

function normalizeLevels(
  values: readonly number[] | Float32Array,
  target: number,
) {
  if (values.length === 0) return [];
  if (values.length <= target) return Array.from(values);
  const bucket = values.length / target;
  return Array.from({ length: target }, (_, index) => {
    const start = Math.floor(index * bucket);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucket));
    let peakLevel = Number.NEGATIVE_INFINITY;
    for (
      let cursor = start;
      cursor < end && cursor < values.length;
      cursor += 1
    ) {
      const value = values[cursor] ?? Number.NaN;
      if (Number.isFinite(value)) peakLevel = Math.max(peakLevel, value);
    }
    return Number.isFinite(peakLevel) ? peakLevel : Number.NaN;
  });
}

function waveformPath(
  samples: readonly number[],
  width: number,
  baseline: number,
  amplitude: number,
) {
  if (samples.length === 0) return "";
  const commands: string[] = [];
  samples.forEach((sample, index) => {
    if (!Number.isFinite(sample)) return;
    const x = (index / Math.max(1, samples.length - 1)) * width;
    const y = baseline - Math.max(-1, Math.min(1, sample)) * amplitude;
    commands.push(
      `${commands.length === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`,
    );
  });
  return commands.join(" ");
}

function dynamicsPath(
  values: readonly number[],
  width: number,
  baseline: number,
  amplitude: number,
) {
  if (values.length === 0) return "";
  const commands: string[] = [];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y =
      baseline -
      clampUnit((value - PLOT_DB_FLOOR) / -PLOT_DB_FLOOR) * amplitude;
    commands.push(
      `${commands.length === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`,
    );
  });
  return commands.join(" ");
}

function spectrumDomain(tracks: readonly PlotTrack[]): SpectrumDomain | null {
  let minimumHz = Number.POSITIVE_INFINITY;
  let maximumHz = Number.NEGATIVE_INFINITY;

  for (const track of tracks) {
    const values = track.spectrum;
    const frequencies = track.spectrumFrequenciesHz;
    if (!values || !frequencies || values.length !== frequencies.length) {
      continue;
    }
    for (const frequency of frequencies) {
      if (!Number.isFinite(frequency) || frequency <= 0) continue;
      minimumHz = Math.min(minimumHz, frequency);
      maximumHz = Math.max(maximumHz, frequency);
    }
  }

  return Number.isFinite(minimumHz) && maximumHz > minimumHz
    ? { minimumHz, maximumHz }
    : null;
}

function frequencyPosition(frequencyHz: number, domain: SpectrumDomain) {
  const minimum = Math.log(domain.minimumHz);
  const span = Math.log(domain.maximumHz) - minimum;
  return span > 0 ? clampUnit((Math.log(frequencyHz) - minimum) / span) : 0;
}

function spectrumPath(
  values: readonly number[] | Float32Array,
  frequenciesHz: readonly number[] | Float32Array,
  domain: SpectrumDomain,
  width: number,
  baseline: number,
  amplitude: number,
) {
  if (values.length === 0 || values.length !== frequenciesHz.length) return "";

  const commands: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN;
    const frequencyHz = frequenciesHz[index] ?? Number.NaN;
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(frequencyHz) ||
      frequencyHz <= 0
    ) {
      continue;
    }
    const x = frequencyPosition(frequencyHz, domain) * width;
    const normalized = clampUnit((value - PLOT_DB_FLOOR) / -PLOT_DB_FLOOR);
    const y = baseline - normalized * amplitude;
    commands.push(
      `${commands.length === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`,
    );
  }
  return commands.join(" ");
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.round(safeSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatFrequency(frequencyHz: number) {
  if (frequencyHz >= 1_000) {
    const value = frequencyHz / 1_000;
    const precision = value >= 10 ? 0 : 1;
    return `${value.toFixed(precision).replace(/\.0$/, "")} kHz`;
  }
  return `${Math.round(frequencyHz)} Hz`;
}

function frequencyTicks(
  domain: SpectrumDomain | null,
  fractions: readonly number[],
) {
  if (!domain) return [];
  const minimum = Math.log(domain.minimumHz);
  const span = Math.log(domain.maximumHz) - minimum;
  return fractions.map((fraction) => ({
    fraction,
    frequencyHz: Math.exp(minimum + span * fraction),
  }));
}

function normalizeSegments(segments: readonly PlotSegment[], duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return segments.flatMap((segment) => {
    const startSeconds = Math.max(0, Math.min(duration, segment.startSeconds));
    const endSeconds = Math.max(0, Math.min(duration, segment.endSeconds));
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      endSeconds <= startSeconds
    ) {
      return [];
    }
    return [
      {
        ...segment,
        start: startSeconds / duration,
        end: endSeconds / duration,
        range:
          segment.range ??
          `${formatTime(startSeconds)} – ${formatTime(endSeconds)}`,
      },
    ];
  });
}

function renderTrack(
  track: PlotTrack,
  view: PlotView,
  width: number,
  headerHeight: number,
  trackHeight: number,
  index: number,
  targetSamples: number,
  domain: SpectrumDomain | null,
): RenderedTrack {
  const center = headerHeight + trackHeight * index + trackHeight / 2;

  if (view === "spectrum") {
    const baseline = center + trackHeight * 0.28;
    const frequencies = track.spectrumFrequenciesHz;
    const values = track.spectrum;
    const path =
      values && frequencies && domain
        ? spectrumPath(
            values,
            frequencies,
            domain,
            width,
            baseline,
            trackHeight * 0.62,
          )
        : "";
    return { ...track, baseline, hasData: path.length > 0, path };
  }

  if (view === "dynamics") {
    const baseline = center + trackHeight * 0.32;
    const values = normalizeLevels(track.dynamics ?? [], targetSamples);
    const path = dynamicsPath(values, width, baseline, trackHeight * 0.66);
    return { ...track, baseline, hasData: path.length > 0, path };
  }

  const values = normalizeSamples(track.samples ?? [], targetSamples);
  const path = waveformPath(values, width, center, trackHeight * 0.39);
  return { ...track, baseline: center, hasData: path.length > 0, path };
}

function EmptyTrackMessage({
  view,
  x,
  y,
}: Readonly<{ view: PlotView; x: number; y: number }>) {
  return (
    <text className="plot-measure" x={x} y={y} textAnchor="middle">
      No {view} evidence available
    </text>
  );
}

export function SignalPlot({
  tracks,
  view = "waveform",
  playhead = 0,
  compact = false,
  showSegments = true,
  segments = NO_PLOT_SEGMENTS,
  duration = 20,
  activeGate = null,
  ariaLabel,
}: Readonly<SignalPlotProps>) {
  const titleId = useId();
  const mobileTitleId = useId();
  const domain = useMemo(() => spectrumDomain(tracks), [tracks]);
  const normalizedSegments = useMemo(
    () => normalizeSegments(segments, duration),
    [duration, segments],
  );
  const showsTimeSegments =
    view !== "spectrum" && showSegments && normalizedSegments.length > 0;

  const width = 1000;
  const headerHeight = showsTimeSegments ? 82 : 34;
  const trackHeight = compact
    ? 120
    : Math.max(118, 332 / Math.max(1, tracks.length));
  const footerHeight = 44;
  const height = headerHeight + trackHeight * tracks.length + footerHeight;
  const paths = useMemo(
    () =>
      tracks.map((track, index) =>
        renderTrack(
          track,
          view,
          width,
          headerHeight,
          trackHeight,
          index,
          620,
          domain,
        ),
      ),
    [domain, headerHeight, trackHeight, tracks, view],
  );

  const mobileWidth = 500;
  const mobilePlotOffset = 96;
  const mobileTraceWidth = mobileWidth - mobilePlotOffset - 12;
  const mobileHeaderHeight = showsTimeSegments ? 70 : 28;
  const mobileTrackHeight = compact ? 110 : tracks.length > 1 ? 132 : 196;
  const mobileFooterHeight = 42;
  const mobileHeight =
    mobileHeaderHeight + mobileTrackHeight * tracks.length + mobileFooterHeight;
  const mobilePaths = useMemo(
    () =>
      tracks.map((track, index) =>
        renderTrack(
          track,
          view,
          mobileTraceWidth,
          mobileHeaderHeight,
          mobileTrackHeight,
          index,
          420,
          domain,
        ),
      ),
    [
      domain,
      mobileHeaderHeight,
      mobileTraceWidth,
      mobileTrackHeight,
      tracks,
      view,
    ],
  );
  const desktopFrequencyTicks = frequencyTicks(domain, DESKTOP_TIME_TICKS);
  const mobileFrequencyTicks = frequencyTicks(domain, MOBILE_TIME_TICKS);
  const showsTimeCursor = view !== "spectrum";

  return (
    <figure className="signal-figure" data-compact={compact || undefined}>
      <svg
        className="signal-plot signal-plot-desktop"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <title id={titleId}>{ariaLabel}</title>

        {showsTimeSegments
          ? normalizedSegments.map((segment, index) => (
              <g
                key={`${segment.label}-${segment.startSeconds}`}
                className="plot-segment"
              >
                {index > 0 ? (
                  <line
                    x1={segment.start * width}
                    x2={segment.start * width}
                    y1={46}
                    y2={height - footerHeight}
                  />
                ) : null}
                <text
                  x={((segment.start + segment.end) / 2) * width}
                  y={23}
                  textAnchor="middle"
                >
                  {segment.label}
                </text>
                <text
                  className="plot-measure"
                  x={((segment.start + segment.end) / 2) * width}
                  y={43}
                  textAnchor="middle"
                >
                  {segment.range}
                </text>
              </g>
            ))
          : null}

        {paths.map((track) => (
          <g key={track.id} className="plot-track" data-color={track.color}>
            <line x1="0" x2={width} y1={track.baseline} y2={track.baseline} />
            <text x="8" y={track.baseline - trackHeight * 0.29}>
              {track.label}
            </text>
            {track.hasData ? (
              <path d={track.path} vectorEffect="non-scaling-stroke" />
            ) : (
              <EmptyTrackMessage
                view={view}
                x={width / 2}
                y={track.baseline - 8}
              />
            )}
          </g>
        ))}

        {showsTimeCursor && activeGate !== null ? (
          <g
            className="active-gate"
            transform={`translate(${clampUnit(activeGate) * width} 0)`}
          >
            <line y1={headerHeight - 8} y2={height - footerHeight} />
            <circle cy={headerHeight - 8} r="5" />
          </g>
        ) : null}

        {showsTimeCursor && playhead > 0 ? (
          <g
            className="playhead"
            transform={`translate(${clampUnit(playhead) * width} 0)`}
          >
            <line y1={headerHeight - 8} y2={height - footerHeight} />
            <path d={`M-6 ${headerHeight - 12}h12l-6 8z`} />
          </g>
        ) : null}

        <g className="plot-ruler">
          <line
            x1="0"
            x2={width}
            y1={height - footerHeight + 6}
            y2={height - footerHeight + 6}
          />
          {(view === "spectrum"
            ? desktopFrequencyTicks
            : DESKTOP_TIME_TICKS.map((fraction) => ({ fraction }))
          ).map((tick) => (
            <g key={tick.fraction}>
              <line
                x1={tick.fraction * width}
                x2={tick.fraction * width}
                y1={height - footerHeight + 6}
                y2={height - footerHeight + 14}
              />
              <text
                x={tick.fraction * width}
                y={height - 10}
                textAnchor={
                  tick.fraction === 0
                    ? "start"
                    : tick.fraction === 1
                      ? "end"
                      : "middle"
                }
              >
                {"frequencyHz" in tick
                  ? formatFrequency(tick.frequencyHz)
                  : formatTime(tick.fraction * duration)}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <svg
        className="signal-plot signal-plot-mobile"
        viewBox={`0 0 ${mobileWidth} ${mobileHeight}`}
        role="img"
        aria-labelledby={mobileTitleId}
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${mobileWidth} / ${mobileHeight}` }}
      >
        <title id={mobileTitleId}>{ariaLabel}</title>

        {showsTimeSegments
          ? normalizedSegments.map((segment, index) => {
              const center =
                mobilePlotOffset +
                ((segment.start + segment.end) / 2) * mobileTraceWidth;
              const start = mobilePlotOffset + segment.start * mobileTraceWidth;
              return (
                <g
                  key={`${segment.label}-${segment.startSeconds}`}
                  className="plot-segment"
                >
                  {index > 0 ? (
                    <line
                      x1={start}
                      x2={start}
                      y1={36}
                      y2={mobileHeight - mobileFooterHeight}
                    />
                  ) : null}
                  <text x={center} y={23} textAnchor="middle">
                    {segment.mobileLabel ?? segment.label}
                  </text>
                </g>
              );
            })
          : null}

        {mobilePaths.map((track) => (
          <g key={track.id} className="plot-track" data-color={track.color}>
            <line
              x1={mobilePlotOffset}
              x2={mobilePlotOffset + mobileTraceWidth}
              y1={track.baseline}
              y2={track.baseline}
            />
            <text x="8" y={track.baseline - mobileTrackHeight * 0.22}>
              {track.label}
            </text>
            {track.hasData ? (
              <path
                d={track.path}
                transform={`translate(${mobilePlotOffset} 0)`}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <EmptyTrackMessage
                view={view}
                x={mobilePlotOffset + mobileTraceWidth / 2}
                y={track.baseline - 8}
              />
            )}
          </g>
        ))}

        {showsTimeCursor && activeGate !== null ? (
          <g
            className="active-gate"
            transform={`translate(${mobilePlotOffset + clampUnit(activeGate) * mobileTraceWidth} 0)`}
          >
            <line
              y1={mobileHeaderHeight - 8}
              y2={mobileHeight - mobileFooterHeight}
            />
            <circle cy={mobileHeaderHeight - 8} r="5" />
          </g>
        ) : null}

        {showsTimeCursor && playhead > 0 ? (
          <g
            className="playhead"
            transform={`translate(${mobilePlotOffset + clampUnit(playhead) * mobileTraceWidth} 0)`}
          >
            <line
              y1={mobileHeaderHeight - 8}
              y2={mobileHeight - mobileFooterHeight}
            />
            <path d={`M-6 ${mobileHeaderHeight - 12}h12l-6 8z`} />
          </g>
        ) : null}

        <g className="plot-ruler">
          <line
            x1={mobilePlotOffset}
            x2={mobilePlotOffset + mobileTraceWidth}
            y1={mobileHeight - mobileFooterHeight + 6}
            y2={mobileHeight - mobileFooterHeight + 6}
          />
          {(view === "spectrum"
            ? mobileFrequencyTicks
            : MOBILE_TIME_TICKS.map((fraction) => ({ fraction }))
          ).map((tick) => (
            <g key={tick.fraction}>
              <line
                x1={mobilePlotOffset + tick.fraction * mobileTraceWidth}
                x2={mobilePlotOffset + tick.fraction * mobileTraceWidth}
                y1={mobileHeight - mobileFooterHeight + 6}
                y2={mobileHeight - mobileFooterHeight + 14}
              />
              <text
                x={mobilePlotOffset + tick.fraction * mobileTraceWidth}
                y={mobileHeight - 9}
                textAnchor={
                  tick.fraction === 0
                    ? "start"
                    : tick.fraction === 1
                      ? "end"
                      : "middle"
                }
              >
                {"frequencyHz" in tick
                  ? formatFrequency(tick.frequencyHz)
                  : formatTime(tick.fraction * duration)}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
    </figure>
  );
}
