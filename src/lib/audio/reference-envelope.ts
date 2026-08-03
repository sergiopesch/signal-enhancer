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
