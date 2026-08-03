export function SignalMark({
  compact = false,
}: Readonly<{ compact?: boolean }>) {
  return (
    <span
      className="signal-mark"
      aria-hidden="true"
      data-compact={compact || undefined}
    >
      <svg viewBox="0 0 64 40" focusable="false">
        <path
          className="signal-mark-trace signal-mark-trace-a"
          d="M2 7h12v7h11v6h7l7 7h11v6h12"
        />
        <path
          className="signal-mark-trace signal-mark-trace-b"
          d="M2 33h12v-7h11v-6h7l7-7h11V7h12"
        />
        <path className="signal-mark-aperture" d="M32 1v14m0 10v14" />
      </svg>
    </span>
  );
}
