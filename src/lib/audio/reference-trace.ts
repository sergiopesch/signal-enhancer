import { createReferenceDiagnostic } from "./reference";

const TRACE_SAMPLE_RATE = 8_000;

/**
 * Produces a compact waveform from the same canonical procedural diagnostic
 * used by the lab. Peak downsampling preserves silence and transient timing.
 */
export function makeReferenceDiagnosticTrace(length = 260): number[] {
  if (!Number.isInteger(length) || length < 2)
    throw new RangeError("Reference traces require at least two samples.");

  const samples = createReferenceDiagnostic(TRACE_SAMPLE_RATE).samples;
  const bucketSize = samples.length / length;

  return Array.from({ length }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    let peak = 0;
    for (
      let cursor = start;
      cursor < end && cursor < samples.length;
      cursor += 1
    ) {
      const sample = samples[cursor] ?? 0;
      if (Math.abs(sample) > Math.abs(peak)) peak = sample;
    }
    return peak;
  });
}
