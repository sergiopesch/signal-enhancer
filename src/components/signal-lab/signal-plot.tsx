"use client";

import { useId, useMemo } from "react";

export type PlotView = "waveform" | "spectrum" | "dynamics" | "difference";

export type PlotTrack = {
  id: string;
  label: string;
  color: "cyan" | "amber" | "neutral";
  samples?: readonly number[] | Float32Array;
  spectrum?: readonly number[] | Float32Array;
};

type SignalPlotProps = {
  tracks: readonly PlotTrack[];
  view?: PlotView;
  playhead?: number;
  compact?: boolean;
  showSegments?: boolean;
  activeGate?: number | null;
  ariaLabel: string;
};

const SEGMENTS = [
  { label: "Silence", range: "0:00 – 0:02", start: 0, end: 0.1 },
  { label: "Sweep", range: "0:02 – 0:06", start: 0.1, end: 0.3 },
  { label: "Clicks", range: "0:06 – 0:10", start: 0.3, end: 0.5 },
  { label: "Quiet probe", range: "0:10 – 0:15", start: 0.5, end: 0.75 },
  { label: "Loud probe", range: "0:15 – 0:20", start: 0.75, end: 1 },
] as const;

function seededNoise(index: number, seed: number) {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export function makeReferenceEnvelope(length = 560, variant = 0): number[] {
  return Array.from({ length }, (_, index) => {
    const progress = index / Math.max(1, length - 1);
    const noise = seededNoise(index, variant + 1);
    if (progress < 0.1) return noise * (0.005 + variant * 0.002);
    if (progress < 0.3) {
      const local = (progress - 0.1) / 0.2;
      const frequency = 5 + local * local * 48;
      return (
        Math.sin(local * Math.PI * 2 * frequency) *
        (0.06 + local * 0.52) *
        (1 - variant * 0.08)
      );
    }
    if (progress < 0.5) {
      const localIndex = Math.floor(((progress - 0.3) / 0.2) * 9);
      const local = ((progress - 0.3) / 0.2) * 9 - localIndex;
      const click = Math.exp(-local * 13) * (localIndex % 2 ? 0.72 : -0.9);
      return click * (1 - variant * 0.14) + noise * 0.018;
    }
    const section = progress < 0.75 ? 0.28 : 0.68;
    const speechShape =
      Math.sin(index * 0.18 + variant) * 0.4 +
      Math.sin(index * 0.49) * 0.27 +
      Math.sin(index * 1.18) * 0.12 +
      noise * 0.22;
    const phraseEnvelope = 0.35 + Math.abs(Math.sin(index * 0.036 + 0.4));
    const compression = variant ? Math.tanh(speechShape * 1.4) : speechShape;
    return (
      compression * section * phraseEnvelope + noise * (variant ? 0.026 : 0.014)
    );
  });
}

function normalizeSamples(
  samples: readonly number[] | Float32Array,
  target = 620,
) {
  if (samples.length === 0) return Array.from({ length: target }, () => 0);
  if (samples.length <= target) return Array.from(samples);
  const bucket = samples.length / target;
  return Array.from({ length: target }, (_, index) => {
    const start = Math.floor(index * bucket);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucket));
    let peak = 0;
    for (
      let cursor = start;
      cursor < end && cursor < samples.length;
      cursor += 1
    ) {
      const value = samples[cursor] ?? 0;
      if (Math.abs(value) > Math.abs(peak)) peak = value;
    }
    return peak;
  });
}

function waveformPath(
  samples: readonly number[],
  width: number,
  baseline: number,
  amplitude: number,
) {
  if (samples.length === 0) return "";
  return samples
    .map((sample, index) => {
      const x = (index / Math.max(1, samples.length - 1)) * width;
      const y = baseline - Math.max(-1, Math.min(1, sample)) * amplitude;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function spectrumPath(
  values: readonly number[],
  width: number,
  baseline: number,
  amplitude: number,
) {
  if (values.length === 0) return "";
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const normalized = Math.max(0, Math.min(1, (value + 100) / 100));
      const y = baseline - normalized * amplitude;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function SignalPlot({
  tracks,
  view = "waveform",
  playhead = 0,
  compact = false,
  showSegments = true,
  activeGate = null,
  ariaLabel,
}: Readonly<SignalPlotProps>) {
  const titleId = useId();
  const mobileTitleId = useId();
  const width = 1000;
  const headerHeight = showSegments ? 82 : 34;
  const trackHeight = compact
    ? 120
    : Math.max(118, 332 / Math.max(1, tracks.length));
  const footerHeight = 44;
  const height = headerHeight + trackHeight * tracks.length + footerHeight;
  const paths = useMemo(
    () =>
      tracks.map((track, index) => {
        const values = normalizeSamples(
          view === "spectrum" && track.spectrum
            ? track.spectrum
            : (track.samples ?? makeReferenceEnvelope(620, index)),
        );
        const baseline = headerHeight + trackHeight * index + trackHeight / 2;
        const path =
          view === "spectrum"
            ? spectrumPath(
                values,
                width,
                baseline + trackHeight * 0.28,
                trackHeight * 0.62,
              )
            : waveformPath(values, width, baseline, trackHeight * 0.39);
        return { ...track, path, baseline };
      }),
    [headerHeight, trackHeight, tracks, view],
  );

  const mobileWidth = 500;
  const mobilePlotOffset = 96;
  const mobileTraceWidth = mobileWidth - mobilePlotOffset - 12;
  const mobileHeaderHeight = showSegments ? 70 : 28;
  const mobileTrackHeight = compact ? 110 : tracks.length > 1 ? 132 : 196;
  const mobileFooterHeight = 42;
  const mobileHeight =
    mobileHeaderHeight + mobileTrackHeight * tracks.length + mobileFooterHeight;
  const mobilePaths = useMemo(
    () =>
      tracks.map((track, index) => {
        const values = normalizeSamples(
          view === "spectrum" && track.spectrum
            ? track.spectrum
            : (track.samples ?? makeReferenceEnvelope(420, index)),
          420,
        );
        const baseline =
          mobileHeaderHeight +
          mobileTrackHeight * index +
          mobileTrackHeight / 2;
        const path =
          view === "spectrum"
            ? spectrumPath(
                values,
                mobileTraceWidth,
                baseline + mobileTrackHeight * 0.28,
                mobileTrackHeight * 0.62,
              )
            : waveformPath(
                values,
                mobileTraceWidth,
                baseline,
                mobileTrackHeight * 0.39,
              );
        return { ...track, path, baseline };
      }),
    [mobileHeaderHeight, mobileTraceWidth, mobileTrackHeight, tracks, view],
  );

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

        {showSegments
          ? SEGMENTS.map((segment, index) => (
              <g key={segment.label} className="plot-segment">
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
            <path d={track.path} vectorEffect="non-scaling-stroke" />
          </g>
        ))}

        {activeGate !== null ? (
          <g
            className="active-gate"
            transform={`translate(${Math.max(0, Math.min(1, activeGate)) * width} 0)`}
          >
            <line y1={headerHeight - 8} y2={height - footerHeight} />
            <circle cy={headerHeight - 8} r="5" />
          </g>
        ) : null}

        {playhead > 0 ? (
          <g
            className="playhead"
            transform={`translate(${Math.max(0, Math.min(1, playhead)) * width} 0)`}
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
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line
                x1={tick * width}
                x2={tick * width}
                y1={height - footerHeight + 6}
                y2={height - footerHeight + 14}
              />
              <text
                x={tick * width}
                y={height - 10}
                textAnchor={
                  tick === 0 ? "start" : tick === 1 ? "end" : "middle"
                }
              >
                0:
                {Math.round(tick * 20)
                  .toString()
                  .padStart(2, "0")}
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

        {showSegments
          ? SEGMENTS.map((segment, index) => {
              const center =
                mobilePlotOffset +
                ((segment.start + segment.end) / 2) * mobileTraceWidth;
              const start = mobilePlotOffset + segment.start * mobileTraceWidth;
              return (
                <g key={segment.label} className="plot-segment">
                  {index > 0 ? (
                    <line
                      x1={start}
                      x2={start}
                      y1={36}
                      y2={mobileHeight - mobileFooterHeight}
                    />
                  ) : null}
                  <text x={center} y={23} textAnchor="middle">
                    {segment.label.replace(" probe", "")}
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
            <path
              d={track.path}
              transform={`translate(${mobilePlotOffset} 0)`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {activeGate !== null ? (
          <g
            className="active-gate"
            transform={`translate(${mobilePlotOffset + Math.max(0, Math.min(1, activeGate)) * mobileTraceWidth} 0)`}
          >
            <line
              y1={mobileHeaderHeight - 8}
              y2={mobileHeight - mobileFooterHeight}
            />
            <circle cy={mobileHeaderHeight - 8} r="5" />
          </g>
        ) : null}

        {playhead > 0 ? (
          <g
            className="playhead"
            transform={`translate(${mobilePlotOffset + Math.max(0, Math.min(1, playhead)) * mobileTraceWidth} 0)`}
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
          {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
              <line
                x1={mobilePlotOffset + tick * mobileTraceWidth}
                x2={mobilePlotOffset + tick * mobileTraceWidth}
                y1={mobileHeight - mobileFooterHeight + 6}
                y2={mobileHeight - mobileFooterHeight + 14}
              />
              <text
                x={mobilePlotOffset + tick * mobileTraceWidth}
                y={mobileHeight - 9}
                textAnchor={
                  tick === 0 ? "start" : tick === 1 ? "end" : "middle"
                }
              >
                0:
                {Math.round(tick * 20)
                  .toString()
                  .padStart(2, "0")}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
    </figure>
  );
}
