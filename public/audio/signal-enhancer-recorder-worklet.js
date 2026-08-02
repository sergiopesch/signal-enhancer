/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class SignalEnhancerMonoRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requestedMaximum = options.processorOptions?.maximumFrames;
    this.maximumFrames = Number.isFinite(requestedMaximum)
      ? Math.max(1, Math.floor(requestedMaximum))
      : sampleRate * 20;
    this.capturedFrames = 0;
    this.chunkFrames = 2048;
    this.pending = new Float32Array(this.chunkFrames);
    this.pendingFrames = 0;
    this.completed = false;
  }

  flush() {
    if (this.pendingFrames === 0) {
      return;
    }
    const samples = this.pending.slice(0, this.pendingFrames);
    this.pendingFrames = 0;
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (const channel of output) {
        channel.fill(0);
      }
    }

    if (this.completed) {
      return false;
    }
    const channels = inputs[0];
    const firstChannel = channels?.[0];
    if (!firstChannel || channels.length === 0) {
      return true;
    }

    const frameCount = Math.min(
      firstChannel.length,
      this.maximumFrames - this.capturedFrames,
    );
    if (frameCount <= 0) {
      this.completed = true;
      this.port.postMessage({ type: "complete" });
      return false;
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      let sum = 0;
      for (
        let channelIndex = 0;
        channelIndex < channels.length;
        channelIndex += 1
      ) {
        sum += channels[channelIndex]?.[frame] ?? 0;
      }
      this.pending[this.pendingFrames] = sum / channels.length;
      this.pendingFrames += 1;
      if (this.pendingFrames === this.chunkFrames) {
        this.flush();
      }
    }
    this.capturedFrames += frameCount;

    if (this.capturedFrames >= this.maximumFrames) {
      this.flush();
      this.completed = true;
      this.port.postMessage({ type: "complete" });
      return false;
    }
    return true;
  }
}

registerProcessor("signal-enhancer-mono-recorder", SignalEnhancerMonoRecorder);
