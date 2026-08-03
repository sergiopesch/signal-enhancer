"use client";

import { ArrowRight, Info, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

type AboutDialogProps = {
  open: boolean;
  demoAvailable: boolean;
  onClose: () => void;
  onLoadDemo: () => void;
};

export function AboutDialog({
  open,
  demoAvailable,
  onClose,
  onLoadDemo,
}: Readonly<AboutDialogProps>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        if (
          previouslyFocused instanceof HTMLElement &&
          previouslyFocused.isConnected
        )
          previouslyFocused.focus();
      });
    };
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeRef}
          type="button"
          className="dialog-close"
          onClick={onClose}
          aria-label="Close About"
        >
          <X size={21} />
        </button>
        <p className="instrument-label">
          Input Chain Fingerprint · Experiment 01
        </p>
        <h2 id="about-title">Capture isn’t neutral.</h2>
        <p>
          A microphone, device, room, operating system, browser, and hidden
          processing can all shape a signal before an app receives it. This lab
          makes those patterns visible without pretending to identify every
          cause.
        </p>
        <div className="about-principles">
          <article>
            <ShieldCheck size={20} />
            <div>
              <strong>Private by default</strong>
              <span>
                No microphone audio leaves this browser before you choose
                Upgrade Signal.
              </span>
            </div>
          </article>
          <article>
            <Info size={20} />
            <div>
              <strong>Evidence, not a verdict</strong>
              <span>
                The lab never ranks devices or calls one capture better.
              </span>
            </div>
          </article>
        </div>
        <p className="about-footnote">
          Read the same guided passage twice, keep your distance and placement
          steady, and expect browser-reported device names to be imperfect.
        </p>
        {demoAvailable ? (
          <button
            type="button"
            className="button button-primary"
            onClick={onLoadDemo}
          >
            Explore a prepared review <ArrowRight size={18} />
          </button>
        ) : null}
      </section>
    </div>
  );
}
