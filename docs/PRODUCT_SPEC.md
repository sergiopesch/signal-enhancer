# Signal Enhancer — Product Specification

## Product thesis

Signal Enhancer is one guided audio experiment:

> One sound, two input chains, one visual comparison, one honest signal upgrade.

Capture is not neutral. A microphone, device, room, operating system, browser, and hidden processing can shape a signal before an application receives it. Signal Enhancer makes that chain visible without pretending to identify every cause and without judging the hardware.

The product is standalone. It is not a tab or extension of My Audio Visualizer.

## Product boundaries

- One lab and one experiment: **Input Chain Fingerprint**.
- Capture Input A and Input B sequentially, never simultaneously.
- Keep the reference sound, room, position, distance, and playback volume as stable as practical.
- Never rank, score, declare a winner, or use “better”/“worse” language.
- Never promise a raw signal; browser and device processing are part of the subject.
- Never claim to imitate a Shure, an expensive microphone, or any specific device.
- One **Upgrade Signal** action. The user does not select models, presets, or processing stages.
- Version one is speech restoration, not real-time enhancement or general music mastering.
- No Cohere or ElevenLabs dependency.

## Canonical journey

### 1. Reference and device setup

The application requests microphone permission, enumerates available audio inputs, reports device labels cautiously, and asks the user to confirm each label. It shows requested constraints and the settings actually reported by the browser when available.

The user selects two input chains. Input A is the capture that will be upgraded at the end; Input B is the comparison capture. This rule is stated before recording so the final action is unsurprising and requires no extra choice.

### 2. Diagnostic reference

A fixed, versioned 20-second WAV exposes different capture behaviours:

| Time    | Segment                             | Purpose                                               |
| ------- | ----------------------------------- | ----------------------------------------------------- |
| 0–2 s   | Silence                             | Estimate steady noise floor                           |
| 2–6 s   | Logarithmic sweep                   | Reveal frequency response and high-frequency roll-off |
| 6–10 s  | Clicks and a restrained noise burst | Reveal transient control, limiting, and suppression   |
| 10–15 s | Quiet speech-shaped probe           | Reveal gain riding and noise suppression              |
| 15–20 s | Louder speech-shaped probe          | Reveal compression, clipping, and peak control        |

The same decoded audio buffer must drive playback for both captures.

The version-one asset is a deterministic procedural probe, not an intelligible voice recording. A licensed, versioned voice asset can replace those two segments later without changing the capture protocol.

### 3. Sequential capture

The product guides Input A and then Input B. Each capture is mono PCM WAV, 48 kHz when the browser/device supports it, with a hard maximum of 20 seconds. The interface reminds the user to preserve room conditions, position, distance, and playback level.

### 4. Reveal

The comparison includes:

- waveform;
- frequency spectrum;
- dynamics/envelope;
- steady noise-floor estimate;
- absolute and loudness-matched modes;
- an A/B difference trace;
- synchronized A, B, and alternating A/B playback;
- cautious plain-language observations.

Descriptions use language such as “carries more high-frequency energy,” “shows a higher steady noise floor,” or “peaks are more tightly controlled.” Every conclusion includes the qualification that patterns may reflect device processing, placement, playback, or the room.

### 5. Upgrade

The final question is: **Can AI reshape this capture into something more powerful?**

Pressing **Upgrade Signal** uploads both WAV captures directly to private object storage and starts one durable job. Input A is restored automatically. The result includes:

- the original Input A WAV;
- a quickly available, clearly labelled local DSP preview;
- the final enhanced WAV;
- original/enhanced/difference visualizations;
- a concise report of detected issues, routing, applied processing, likely changes, and limitations;
- the exact pipeline and model versions used.

Restored content is always described as inferred. The report must not imply that missing information was recovered with certainty.

## Real progress states

The UI may only display stages emitted by the backend:

1. Receiving capture
2. Inspecting signal
3. Detecting noise and compression
4. Restoring detail
5. Polishing dynamics
6. Generating difference map
7. Preparing report

During a cold start, use “Warming upgrade engine” and “This can take longer after a quiet period.” Do not show a fabricated percentage or precise ETA.

## Privacy and limits

- Anonymous, signed session cookie; no account is required for v1.
- One deep upgrade per session.
- Three session starts per hour per network identifier as an initial abuse backstop.
- A configurable global daily job cap; production starts at 100 jobs/day until measured costs justify a change.
- Private Blob storage only.
- Session audio and derived files expire after 24 hours.
- No microphone data leaves the browser before the user presses **Upgrade Signal**.
- A failed or timed-out AI pass preserves the local DSP preview and explains that the deeper restoration was unavailable.

## Success criteria

- A first-time user can complete the experiment without audio expertise.
- Device uncertainty and analytical limitations are visible, not hidden in legal copy.
- The reveal communicates difference without implying quality.
- The upgrade never exposes infrastructure or model choices.
- The core journey works with keyboard, screen reader, touch, reduced motion, and narrow mobile layouts.
- Warm upgrades target 10–40 seconds; cold-start behaviour is measured rather than promised.

## Deferred from v1

- real-time enhancement;
- accounts and saved libraries;
- public sharing;
- more than one experiment;
- simultaneous multi-input recording;
- system/tab-audio capture;
- user-selected models, presets, or mastering controls;
- microphone or brand emulation;
- generalized music restoration.
