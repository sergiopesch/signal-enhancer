export function SignalMark({
  compact = false,
}: Readonly<{ compact?: boolean }>) {
  return (
    <span
      className="signal-mark"
      aria-hidden="true"
      data-compact={compact || undefined}
    >
      <svg viewBox="0 0 42 24" role="img">
        <path d="M1 12h5l2-5 3 12 3-18 4 22 3-17 4 14 3-8h5l2-4 2 8h4" />
      </svg>
    </span>
  );
}
