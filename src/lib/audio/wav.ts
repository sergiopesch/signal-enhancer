import { AudioUtilityError, assertFiniteSampleRate } from "./errors";
import { clamp, sanitizeSample } from "./math";
import type { DecodedWav, MonoAudio } from "./types";

const RIFF_HEADER_BYTES = 12;
const PCM_FORMAT = 0x0001;
const IEEE_FLOAT_FORMAT = 0x0003;
const EXTENSIBLE_FORMAT = 0xfffe;
const MAX_CHANNELS = 16;
const MAX_DECODED_SAMPLES = 384_000 * 60 * 10;

export type WavEncoding = "pcm16" | "pcm24" | "float32";

export interface EncodeWavOptions {
  readonly encoding?: WavEncoding;
}

interface FormatChunk {
  readonly formatCode: number;
  readonly channelCount: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly bitsPerSample: number;
}

function fourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function writeFourCc(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < 4; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function asDataView(source: ArrayBuffer | ArrayBufferView): DataView {
  if (source instanceof ArrayBuffer) {
    return new DataView(source);
  }
  return new DataView(source.buffer, source.byteOffset, source.byteLength);
}

function parseFormatChunk(
  view: DataView,
  offset: number,
  size: number,
): FormatChunk {
  if (size < 16 || offset + size > view.byteLength) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The WAV format chunk is truncated.",
    );
  }

  let formatCode = view.getUint16(offset, true);
  const channelCount = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const bitsPerSample = view.getUint16(offset + 14, true);

  if (formatCode === EXTENSIBLE_FORMAT) {
    if (size < 40 || view.getUint16(offset + 16, true) < 22) {
      throw new AudioUtilityError(
        "invalid-wav",
        "The extensible WAV format chunk is incomplete.",
      );
    }
    formatCode = view.getUint16(offset + 24, true);
  }

  if (formatCode !== PCM_FORMAT && formatCode !== IEEE_FLOAT_FORMAT) {
    throw new AudioUtilityError(
      "unsupported-wav",
      `WAV format ${formatCode} is not supported; use uncompressed PCM or IEEE float audio.`,
    );
  }
  if (channelCount < 1 || channelCount > MAX_CHANNELS) {
    throw new AudioUtilityError(
      "unsupported-wav",
      `WAV channel count ${channelCount} is not supported.`,
    );
  }
  assertFiniteSampleRate(sampleRate);

  const validPcmDepth = [8, 16, 24, 32].includes(bitsPerSample);
  const validFloatDepth = [32, 64].includes(bitsPerSample);
  if (
    (formatCode === PCM_FORMAT && !validPcmDepth) ||
    (formatCode === IEEE_FLOAT_FORMAT && !validFloatDepth)
  ) {
    throw new AudioUtilityError(
      "unsupported-wav",
      `${bitsPerSample}-bit ${formatCode === PCM_FORMAT ? "PCM" : "float"} WAV audio is not supported.`,
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  if (
    !Number.isInteger(bytesPerSample) ||
    blockAlign < channelCount * bytesPerSample
  ) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The WAV block alignment is inconsistent with its format.",
    );
  }

  return { formatCode, channelCount, sampleRate, blockAlign, bitsPerSample };
}

function decodePcmSample(
  view: DataView,
  offset: number,
  bitsPerSample: number,
): number {
  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32_768;
    case 24: {
      let value =
        view.getUint8(offset) |
        (view.getUint8(offset + 1) << 8) |
        (view.getUint8(offset + 2) << 16);
      if ((value & 0x80_0000) !== 0) {
        value |= ~0xff_ffff;
      }
      return value / 8_388_608;
    }
    case 32:
      return view.getInt32(offset, true) / 2_147_483_648;
    default:
      return 0;
  }
}

function downmix(
  channelData: readonly Float32Array[],
  frameCount: number,
): Float32Array {
  if (channelData.length === 1) {
    return channelData[0]?.slice() ?? new Float32Array();
  }
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (const channel of channelData) {
      sum += channel[frame] ?? 0;
    }
    mono[frame] = sum / channelData.length;
  }
  return mono;
}

export function parseWav(source: ArrayBuffer | ArrayBufferView): DecodedWav {
  const view = asDataView(source);
  if (
    view.byteLength < RIFF_HEADER_BYTES ||
    fourCc(view, 0) !== "RIFF" ||
    fourCc(view, 8) !== "WAVE"
  ) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The file is not a RIFF/WAVE audio file.",
    );
  }

  const declaredEnd = view.getUint32(4, true) + 8;
  if (declaredEnd > view.byteLength) {
    throw new AudioUtilityError("invalid-wav", "The WAV file is truncated.");
  }
  const parseEnd = Math.min(declaredEnd, view.byteLength);
  let offset = RIFF_HEADER_BYTES;
  let format: FormatChunk | null = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= parseEnd) {
    const chunkId = fourCc(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkSize;
    if (payloadEnd > parseEnd) {
      throw new AudioUtilityError(
        "invalid-wav",
        `The WAV ${chunkId} chunk is truncated.`,
      );
    }

    if (chunkId === "fmt ") {
      format = parseFormatChunk(view, payloadOffset, chunkSize);
    } else if (chunkId === "data" && dataOffset < 0) {
      dataOffset = payloadOffset;
      dataSize = chunkSize;
    }
    offset = payloadEnd + (chunkSize % 2);
  }

  if (format === null) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The WAV file has no format chunk.",
    );
  }
  if (dataOffset < 0) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The WAV file has no audio data chunk.",
    );
  }
  if (dataSize % format.blockAlign !== 0) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The WAV data does not contain a whole number of frames.",
    );
  }

  const frameCount = dataSize / format.blockAlign;
  if (frameCount * format.channelCount > MAX_DECODED_SAMPLES) {
    throw new AudioUtilityError(
      "invalid-wav",
      "The WAV file exceeds the local decode safety limit.",
    );
  }

  const channelData = Array.from(
    { length: format.channelCount },
    () => new Float32Array(frameCount),
  );
  const bytesPerSample = format.bitsPerSample / 8;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * format.blockAlign;
    for (let channel = 0; channel < format.channelCount; channel += 1) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      const decoded =
        format.formatCode === PCM_FORMAT
          ? decodePcmSample(view, sampleOffset, format.bitsPerSample)
          : format.bitsPerSample === 32
            ? view.getFloat32(sampleOffset, true)
            : view.getFloat64(sampleOffset, true);
      const target = channelData[channel];
      if (target !== undefined) {
        target[frame] = sanitizeSample(decoded);
      }
    }
  }

  return {
    samples: downmix(channelData, frameCount),
    channelData,
    sampleRate: format.sampleRate,
    numberOfChannels: format.channelCount,
    numberOfFrames: frameCount,
    durationSeconds: frameCount / format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    sampleFormat: format.formatCode === PCM_FORMAT ? "pcm" : "ieee-float",
  };
}

export async function decodeWav(
  source: Blob | ArrayBuffer | ArrayBufferView,
): Promise<DecodedWav> {
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return parseWav(await source.arrayBuffer());
  }
  return parseWav(source as ArrayBuffer | ArrayBufferView);
}

function assertChannels(channelData: readonly Float32Array[]): number {
  if (channelData.length < 1 || channelData.length > MAX_CHANNELS) {
    throw new AudioUtilityError(
      "invalid-audio",
      "WAV encoding requires between 1 and 16 channels.",
    );
  }
  const frameCount = channelData[0]?.length ?? 0;
  for (const channel of channelData) {
    if (!(channel instanceof Float32Array) || channel.length !== frameCount) {
      throw new AudioUtilityError(
        "invalid-audio",
        "Every WAV channel must have the same frame count.",
      );
    }
  }
  return frameCount;
}

export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  options?: EncodeWavOptions,
): ArrayBuffer;
export function encodeWav(
  samples: readonly Float32Array[],
  sampleRate: number,
  options?: EncodeWavOptions,
): ArrayBuffer;
export function encodeWav(
  samples: Float32Array | readonly Float32Array[],
  sampleRate: number,
  options: EncodeWavOptions = {},
): ArrayBuffer {
  assertFiniteSampleRate(sampleRate);
  const channelData = samples instanceof Float32Array ? [samples] : samples;
  const frameCount = assertChannels(channelData);
  const encoding = options.encoding ?? "pcm16";
  const bitsPerSample =
    encoding === "pcm16" ? 16 : encoding === "pcm24" ? 24 : 32;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelData.length * bytesPerSample;
  const dataBytes = frameCount * blockAlign;
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffff_ffff - 36) {
    throw new AudioUtilityError(
      "invalid-audio",
      "The audio is too large for a standard RIFF/WAVE file.",
    );
  }
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeFourCc(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeFourCc(view, 8, "WAVE");
  writeFourCc(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(
    20,
    encoding === "float32" ? IEEE_FLOAT_FORMAT : PCM_FORMAT,
    true,
  );
  view.setUint16(22, channelData.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeFourCc(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let writeOffset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (const channel of channelData) {
      const finiteSample = sanitizeSample(channel[frame] ?? 0);
      const sample =
        encoding === "float32" ? finiteSample : clamp(finiteSample, -1, 1);
      if (encoding === "pcm16") {
        const value =
          sample < 0
            ? Math.round(sample * 32_768)
            : Math.round(sample * 32_767);
        view.setInt16(writeOffset, value, true);
      } else if (encoding === "pcm24") {
        let value =
          sample < 0
            ? Math.round(sample * 8_388_608)
            : Math.round(sample * 8_388_607);
        value = Math.max(-8_388_608, Math.min(8_388_607, value));
        view.setUint8(writeOffset, value & 0xff);
        view.setUint8(writeOffset + 1, (value >> 8) & 0xff);
        view.setUint8(writeOffset + 2, (value >> 16) & 0xff);
      } else {
        view.setFloat32(writeOffset, sample, true);
      }
      writeOffset += bytesPerSample;
    }
  }
  return buffer;
}

export function encodeMonoWav(
  audio: MonoAudio,
  options: EncodeWavOptions = {},
): ArrayBuffer {
  return encodeWav(audio.samples, audio.sampleRate, options);
}
