import { describe, expect, it } from "vitest";

import { AudioUtilityError, decodeWav, encodeWav, parseWav } from "../index";

function sine(
  sampleRate: number,
  frequency: number,
  durationSeconds: number,
  amplitude = 0.5,
): Float32Array {
  return Float32Array.from(
    { length: Math.round(sampleRate * durationSeconds) },
    (_, index) =>
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude,
  );
}

describe("WAV codec", () => {
  it("encodes and decodes mono PCM16 through the simple integration overload", () => {
    const input = sine(48_000, 997, 0.1);
    const bytes = encodeWav(input, 48_000);
    const decoded = parseWav(bytes);

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.numberOfChannels).toBe(1);
    expect(decoded.numberOfFrames).toBe(input.length);
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.sampleFormat).toBe("pcm");
    expect(decoded.samples[137]).toBeCloseTo(input[137] ?? 0, 4);
  });

  it.each(["pcm24", "float32"] as const)("round-trips %s audio", (encoding) => {
    const input = Float32Array.from([-1, -0.5, 0, 0.25, 0.999]);
    const decoded = parseWav(encodeWav(input, 44_100, { encoding }));
    expect(Array.from(decoded.samples)).toEqual(
      expect.arrayContaining(
        Array.from(input, (sample) =>
          expect.closeTo(sample, encoding === "pcm24" ? 6 : 5),
        ),
      ),
    );
  });

  it("preserves finite super-unity samples in IEEE-float WAVs", () => {
    const decoded = parseWav(
      encodeWav(Float32Array.from([1.25, -1.5]), 48_000, {
        encoding: "float32",
      }),
    );
    expect(decoded.samples[0]).toBeCloseTo(1.25, 6);
    expect(decoded.samples[1]).toBeCloseTo(-1.5, 6);
  });

  it("skips unknown odd-sized RIFF chunks including their padding byte", () => {
    const original = new Uint8Array(
      encodeWav(Float32Array.from([0.25, -0.25]), 16_000),
    );
    const withJunk = new Uint8Array(original.length + 10);
    withJunk.set(original.subarray(0, 12), 0);
    withJunk.set(new TextEncoder().encode("JUNK"), 12);
    new DataView(withJunk.buffer).setUint32(16, 1, true);
    withJunk[20] = 0x7f;
    withJunk[21] = 0;
    withJunk.set(original.subarray(12), 22);
    new DataView(withJunk.buffer).setUint32(4, withJunk.length - 8, true);

    const decoded = parseWav(withJunk);
    expect(decoded.samples).toHaveLength(2);
    expect(decoded.samples[0]).toBeCloseTo(0.25, 4);
  });

  it("preserves channels and returns a neutral mono downmix", () => {
    const left = Float32Array.from([0.5, -0.5, 0.25]);
    const right = Float32Array.from([-0.5, 0.5, 0.25]);
    const decoded = parseWav(encodeWav([left, right], 48_000));

    expect(decoded.numberOfChannels).toBe(2);
    expect(Array.from(decoded.channelData[0] ?? [])).toEqual(
      expect.arrayContaining(
        Array.from(left, (sample) => expect.closeTo(sample, 4)),
      ),
    );
    expect(decoded.samples[0]).toBeCloseTo(0, 5);
    expect(decoded.samples[1]).toBeCloseTo(0, 5);
    expect(decoded.samples[2]).toBeCloseTo(0.25, 4);
  });

  it("decodes Blob inputs", async () => {
    const bytes = encodeWav(Float32Array.from([0, 0.25, -0.25]), 16_000);
    const decoded = await decodeWav(new Blob([bytes], { type: "audio/wav" }));
    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.samples).toHaveLength(3);
  });

  it("rejects truncated and non-WAV input with stable typed errors", () => {
    for (const invalid of [
      new Uint8Array([1, 2, 3]).buffer,
      encodeWav(new Float32Array(8), 8_000).slice(0, 30),
    ]) {
      try {
        parseWav(invalid);
        throw new Error("Expected parsing to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(AudioUtilityError);
        expect((error as AudioUtilityError).code).toBe("invalid-wav");
      }
    }
  });
});
