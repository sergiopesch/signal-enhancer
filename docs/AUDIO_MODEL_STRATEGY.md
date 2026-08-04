# Audio model strategy

**Decision date:** 3 August 2026

Signal Enhancer treats perceptual quality, word preservation, and speaker identity as separate release gates. A higher no-reference quality score is not enough if a model rewrites consonants, prosody, or the speaker.

## Production decision

The production route remains the exact [`ResembleAI/resemble-enhance`](https://huggingface.co/ResembleAI/resemble-enhance/tree/4e3510ce4a8391159f665903544c5150bee7b2cb) checkpoint at `4e3510ce4a8391159f665903544c5150bee7b2cb`, whose Hub card declares the MIT license, served from a custom authenticated Hugging Face Inference Endpoint. It combines denoising with bandwidth/detail restoration, works on the complete 20-second protocol without a chunk seam, and is the commercially compatible production choice among the reviewed candidates. The worker also pins the MIT-licensed upstream source, validates every mounted artifact, fixes its inference profile, and records that provenance in every receipt.

Hugging Face custom endpoints mount the selected model artifacts at `/repository`; this deployment selects an immutable commit SHA, and the worker loads only that mount instead of downloading floating weights at runtime. See the official [custom-container guide](https://huggingface.co/docs/inference-endpoints/engines/custom_container).

## Challenger matrix

| Route                                                                                 | Role                    | Decision                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resemble Enhance                                                                      | Production              | Best deployable balance for full-band, 20-second speech restoration in the current product.                                                                                                          |
| [Alibaba MossFormer2 SE 48K](https://huggingface.co/alibabasglab/MossFormer2_SE_48K)  | Conservative challenger | Native 48 kHz and Apache-2.0; benchmark as a lower-hallucination denoising route.                                                                                                                    |
| [SpeechBrain MetricGAN+](https://huggingface.co/speechbrain/metricgan-plus-voicebank) | Lightweight baseline    | Well documented but limited to 16 kHz, so it cannot preserve the captured full band.                                                                                                                 |
| [SaruLab Sidon](https://huggingface.co/sarulab-speech/sidon-v0.1)                     | Research challenger     | MIT and fast, but vocoder re-synthesis needs strict identity, transcript, and prosody validation.                                                                                                    |
| NVIDIA RE-USE                                                                         | Research only           | Technically compelling and current, but its [model card](https://huggingface.co/nvidia/RE-USE) says R&D only and uses a noncommercial license. It cannot ship without a separate commercial license. |

No public model card establishes a universal “best” system across this product’s microphones, rooms, browsers, languages, and voices. Marketing claims must therefore follow our own reproducible evaluation, not leaderboard position.

## Promotion gate

A candidate is evaluated on the fixed 36-word protocol plus held-out voices across laptop, phone, headset, and USB microphones. The corpus must cover steady noise, transient noise, reverberation, clipping, codec damage, and bandwidth limitation.

Every candidate is loudness-matched and measured for:

- transcript preservation: CER/WER against the known passage;
- identity and prosody stability: ephemeral speaker similarity, pitch contour, and timing drift;
- restoration: DNSMOS P.835 plus PESQ, STOI, and SI-SDR where a clean reference exists;
- signal safety: true peak, clipping, DC offset, bandwidth, and temporal alignment;
- human judgment: randomized, loudness-matched ABX listening on headphones, phone, and laptop speakers.

A route is rejected if perceptual quality rises while transcript accuracy or speaker fidelity regresses beyond the approved baseline. Speaker embeddings used in evaluation are ephemeral and are never retained as product data.

## Runtime contract

- Production requires the AI engine and forbids silent DSP fallback.
- A model error leaves the already-created browser preview available and fails the deeper pass honestly.
- Output is resampled with a band-limited windowed-sinc path, aligned to Input A, and loudness-matched against the original capture.
- The browser verifies the enhanced WAV SHA-256 before decoding it.
- The UI exposes the model family and short immutable revision; full provenance remains in the backend receipt.
- This is a speech enhancer, not a general music restoration route.
