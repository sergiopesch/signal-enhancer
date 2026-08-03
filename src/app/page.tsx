import Link from "next/link";

import { SignalMark } from "@/components/signal-lab/signal-mark";
import { makeReferenceDiagnosticTrace } from "@/lib/audio/reference-trace";

import styles from "./page.module.css";

const TRACE_WIDTH = 960;
const TRACE_BASELINE = 190;
const TRACE_AMPLITUDE = 116;

const referenceTrace = makeReferenceDiagnosticTrace(260);
const referencePath = referenceTrace
  .map((sample, index) => {
    const x = (index / Math.max(1, referenceTrace.length - 1)) * TRACE_WIDTH;
    const y =
      TRACE_BASELINE - Math.max(-1, Math.min(1, sample)) * TRACE_AMPLITUDE;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  })
  .join(" ");

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Signal Enhancer home"
        >
          <SignalMark />
          <span>Signal Enhancer</span>
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Comparative listening instrument</p>
            <h1 id="landing-title" className={styles.title}>
              <span>Every input</span>
              <span>leaves a trace.</span>
            </h1>
            <p className={styles.premise}>
              Compare how two input chains shape the same 20-second
              reference—without ranking either.
            </p>
            <div className={styles.actionGroup}>
              <Link
                className={styles.primaryAction}
                href="/lab"
                prefetch={false}
              >
                <span>Begin the comparison</span>
                <span className={styles.actionArrow} aria-hidden="true">
                  →
                </span>
              </Link>
              <p className={styles.assurance}>
                Browser-first · audio stays here in demo mode
              </p>
            </div>
          </div>

          <div className={styles.signalField} aria-hidden="true">
            <div className={styles.signalMeta}>
              <span>Reference · diagnostic-speech-v1</span>
              <span>20.0 s</span>
            </div>
            <div className={styles.traceReveal}>
              <svg
                className={styles.trace}
                viewBox="0 0 960 380"
                focusable="false"
                preserveAspectRatio="none"
              >
                <path className={styles.traceBaseline} d="M0 190H960" />
                <path className={styles.referenceTrace} d={referencePath} />
                <path className={styles.aperture} d="M480 20V154M480 226V360" />
                <path
                  className={styles.tick}
                  d="M0 178V202M240 182V198M720 182V198M960 178V202"
                />
              </svg>
            </div>
            <div className={styles.timeScale}>
              <span>0:00</span>
              <span>same source · two captures</span>
              <span>0:20</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
