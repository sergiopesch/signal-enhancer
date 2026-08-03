# Signal Enhancer — Product Specification

## Product thesis

Signal Enhancer is one guided audio experiment:

> One script, two input chains, two separate passes, one honest Input A upgrade.

Capture is not neutral. A microphone, device, room, operating system, browser, and hidden processing can shape a signal before an application receives it. Signal Enhancer makes each recorded chain inspectable without pretending to identify every cause and without judging the hardware.

The product is standalone. It is not a tab or extension of My Audio Visualizer.

## Product boundaries

- One lab and one experiment: **Input Chain Fingerprint**.
- Repeat the same 36-word, versioned script in two separate 20-second passes: Input A first, then Input B.
- Keep the script, room, position, distance, and speaking style as stable as practical.
- Never rank, score, declare a winner, or use “better”/“worse” language.
- Never promise a raw signal; browser and device processing are part of the subject.
- Never claim to imitate a Shure, an expensive microphone, or any specific device.
- One **Upgrade Input A** action. The user does not select models, presets, or processing stages.
- Version one is speech restoration, not real-time enhancement or general music mastering.
- No Cohere or ElevenLabs dependency.

## Canonical journey

### 0. Entry threshold

The public homepage is a quiet threshold into the experiment, not the experiment itself. It shows one product premise, one primary action, one privacy assurance, and a finite signal horizon. The dual-signal enhancement-gate mark remains static. Workflow navigation, device access, the guided-reading plate, metadata, and the audio client load only after the user enters the instrument at `/lab`.

### 1. Reading and device setup

The application requests microphone permission, enumerates available audio inputs, reports device labels cautiously, and asks the user to confirm each label. It shows requested constraints and the settings actually reported by the browser when available.

The user selects two input chains. Input A is the capture that will be upgraded at the end; Input B is a second recording made under the same protocol. This rule is stated before recording so the final action is unsurprising and requires no extra choice.

The setup surface shows the complete reading passage and offers a silent timing practice. Practice is never recorded and does not play reference audio.

### 2. `guided-reading-v1`

The controlled source is the same fixed, versioned 36-word script spoken twice by the user. Each recording has a three-second silent count-in before the 20-second capture clock starts. The complete passage remains visible during preparation, count-in, and capture; highlighting guides the active cue without hiding earlier or later text.

Canonical passage:

> Beyond the quiet room, clear voices travel through glass and open air. Soft rain settles; small clocks click, and each calm breath leaves a trace. Finish this final line at your natural pace, with steady energy.

| Capture time | Direction      | Script                                                                      | Measurement intent                                   |
| ------------ | -------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| 0–2 s        | Room tone      | Stay silent and keep still.                                                 | Describe opening digital energy                      |
| 2–8 s        | Natural voice  | Beyond the quiet room, clear voices travel through glass and open air.      | Measure everyday reading level and headroom          |
| 8–14 s       | Soft but clear | Soft rain settles; small clocks click, and each calm breath leaves a trace. | Inspect whether the softer direction remains visible |
| 14–20 s      | Natural finish | Finish this final line at your natural pace, with steady energy.            | Check a steady return to the everyday delivery       |

The cue schedule is part of the protocol. It supports repeatable time ranges; it does not make two human deliveries acoustically identical.

### 3. Sequential capture and recovery

The product guides Input A and then Input B. Each pass is mono PCM WAV, 48 kHz when the browser/device supports it, with a hard maximum of 20 seconds. The interface reminds the user to preserve room conditions, position, distance, and speaking style.

After each pass, the user can:

- listen to that capture by itself;
- retake it without advancing;
- continue to Input B after Input A, or continue to individual track review after Input B.

The three-second count-in is not part of the stored WAV. Stopping or retaking a pass never creates a hidden comparison or silently chooses a preferred take. If the browser recorder returns more than 50 milliseconds short of the 20-second protocol, the pass is rejected for retake instead of stretching missing audio across a complete timeline.

### 4. Individual track review

The reveal is a one-track-at-a-time inspection surface:

- Input A and Input B are separate, keyboard-operable tabs;
- only the selected recording is drawn and only one source can play;
- changing tabs stops current playback before the next recording is selected;
- waveform, spectrum, and dynamics are separate views;
- waveform uses time in seconds and linear PCM sample amplitude relative to digital full scale (`-1` to `+1`);
- spectrum uses frequency in hertz on a logarithmic axis and magnitude in dBFS;
- dynamics uses time in seconds and an RMS envelope in dBFS;
- recorded sample and level values are preserved without per-track peak, RMS, or loudness scaling;
- cue buttons and findings identify their exact 0–20 second evidence range and move the playhead to that range;
- whole-capture RMS, highest sample, opening room tone, and a dynamic-range proxy provide measured context.

Published, deterministic thresholds may surface capture length, room-tone energy, spoken level, natural-to-soft contrast, clipping, and digital headroom. Findings are grouped as **What held up**, **Worth inspecting**, and **Measured context**. These labels describe a recording, not a person, microphone, or quality rank.

Every review carries the visible limitation that voice delivery, distance, position, room sound, and browser or device processing can all affect the result. Cue contrast is withheld when the spoken ranges sit too close to room-tone energy, and clipped ranges are qualified rather than over-interpreted. The assessment contract also suppresses positive findings when given an incomplete capture, even though the guided UI rejects that pass earlier.

### 5. Upgrade Input A

The final question is: **Can AI reshape Input A into something more powerful?**

Pressing **Upgrade Input A** uploads both committed WAV captures directly to private object storage and starts one durable job. Input A is restored automatically. The result includes:

- the original Input A WAV;
- a quickly available, clearly labelled local DSP preview;
- the final enhanced Input A WAV;
- original and enhanced Input A evidence;
- a concise report of detected issues, routing, applied processing, likely changes, and limitations;
- the pipeline and model versions retained by the backend.

Restored content is always described as inferred. The report must not imply that missing information was recovered with certainty.

## Real progress states

The UI may display only deterministic local stages or stages actually emitted by the backend. Named stages describe work, never an invented completion percentage. During a cold start, use “Warming upgrade engine” and “This can take longer after a quiet period.” Do not show a fabricated percentage or precise ETA.

## Privacy and limits

- Anonymous, signed session cookie; no account is required for v1.
- One deep upgrade per session.
- Three session starts per hour per network identifier as an initial abuse backstop.
- A configurable global daily job cap; production starts at 100 jobs/day until measured costs justify a change.
- Private Blob storage only.
- Access to session audio and derived files expires with the 24-hour session; authenticated cleanup deletes tracked objects after expiry and keeps discovery rows through the bounded write-drain before cascade.
- No microphone data leaves the browser before the user presses **Upgrade Input A**.
- A failed or timed-out AI pass preserves the local DSP preview and explains that the deeper restoration was unavailable.

## Success criteria

- A first-time user can complete both guided-reading passes without audio expertise.
- The full script, active cue, count-in, and capture status remain understandable without relying on motion or color.
- Every completed capture can be listened to, retaken, or continued deliberately.
- Device uncertainty and analytical limitations are visible, not hidden in legal copy.
- Individual review communicates evidence without implying a quality rank or causing both recordings to play together.
- Plot axes, units, cue ranges, and threshold-based findings remain inspectable.
- The upgrade never exposes infrastructure or model choices.
- The core journey works with keyboard, screen reader, touch, reduced motion, and narrow mobile layouts.
- Warm upgrades target 10–40 seconds; cold-start behaviour is measured rather than promised.

## Deferred from v1

- real-time enhancement;
- accounts and saved libraries;
- public sharing;
- more than one experiment;
- recording multiple inputs in a single pass;
- system/tab-audio capture;
- user-selected models, presets, or mastering controls;
- microphone or brand emulation;
- generalized music restoration.
