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
          className="signal-mark-trace signal-mark-trace-a signal-mark-input"
          d="M2 7h9v3h6v3h6v4h8"
        />
        <path
          className="signal-mark-trace signal-mark-trace-b signal-mark-input"
          d="M2 33h9v-3h6v-3h6v-4h8"
        />
        <path
          className="signal-mark-trace signal-mark-trace-a signal-mark-output"
          d="M33 17h7v-4h8V6h14"
        />
        <path
          className="signal-mark-trace signal-mark-trace-b signal-mark-output"
          d="M33 23h7v4h8v7h14"
        />
        <path className="signal-mark-enhancer" d="M32 1V39" />
      </svg>
    </span>
  );
}
