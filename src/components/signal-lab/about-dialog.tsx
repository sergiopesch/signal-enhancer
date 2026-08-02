"use client";

import { ArrowRight, Info, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
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
          Use speakers for the reference sound, keep the room and placement
          steady, and expect browser-reported device names to be imperfect.
        </p>
        {demoAvailable ? (
          <button
            type="button"
            className="button button-primary"
            onClick={onLoadDemo}
          >
            Explore a prepared comparison <ArrowRight size={18} />
          </button>
        ) : null}
      </section>
    </div>
  );
}
