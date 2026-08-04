import { ChevronsRight, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { AlienSignalScene } from "@/components/immersive/alien-signal-scene";
import { SignalMark } from "@/components/signal-lab/signal-mark";
import { makeGuidedReadingDisplayTrace } from "@/lib/audio/reading-passage";

import styles from "./page.module.css";

const TIMELINE_WIDTH = 1200;
const TIMELINE_BASELINE = 27;
const TIMELINE_AMPLITUDE = 8.5;
const TIMELINE_GUTTER = 11;
const TIMELINE_GATE = TIMELINE_WIDTH / 2;

const referenceTrace = makeGuidedReadingDisplayTrace(168);

function makeTimelinePath(start: number, end: number, phase: number) {
  return referenceTrace
    .map((sample, index) => {
      const shiftedIndex = (index + phase) % referenceTrace.length;
      const shiftedSample = referenceTrace[shiftedIndex] ?? sample;
      const progress = index / Math.max(1, referenceTrace.length - 1);
      const x = start + progress * (end - start);
      const edgeTaper = Math.sin(Math.PI * progress) ** 0.22;
      const y =
        TIMELINE_BASELINE -
        Math.max(-1, Math.min(1, shiftedSample)) *
          TIMELINE_AMPLITUDE *
          edgeTaper;

      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

const inputAPath = makeTimelinePath(TIMELINE_GUTTER, TIMELINE_GATE - 5, 0);
const inputBPath = makeTimelinePath(
  TIMELINE_GATE + 5,
  TIMELINE_WIDTH - TIMELINE_GUTTER,
  29,
);
const tickPath = Array.from({ length: 31 }, (_, index) => {
  const x =
    TIMELINE_GUTTER + (index / 30) * (TIMELINE_WIDTH - TIMELINE_GUTTER * 2);
  const tall = index % 5 === 0;
  return `M${x.toFixed(2)} ${tall ? 5 : 9}V${tall ? 20 : 17}`;
}).join(" ");

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
          <span className={styles.brandDivider} aria-hidden="true" />
          <span>Signal Enhancer</span>
        </Link>

        <div className={styles.calibrationGlyph} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.sceneFrame}>
            <AlienSignalScene />
          </div>

          <div className={styles.copy}>
            <h1 id="landing-title" className={styles.title}>
              <span>Every input</span>
              <span>leaves a trace.</span>
            </h1>
            <p className={styles.premise}>
              Read one 20-second passage through two input chains, then inspect
              each capture on its own.
            </p>
            <div className={styles.actionGroup}>
              <Link
                className={styles.primaryAction}
                href="/lab"
                prefetch={false}
              >
                <span className={styles.actionGlyph} aria-hidden="true">
                  <ChevronsRight strokeWidth={1.35} />
                </span>
                <span>Begin the comparison</span>
              </Link>
              <p className={styles.assurance}>
                <LockKeyhole aria-hidden="true" strokeWidth={1.4} />
                <span>Browser-first · audio stays here in demo mode</span>
              </p>
            </div>
          </div>

          <div className={styles.timeline} aria-hidden="true">
            <div className={styles.timelineLabels}>
              <span>0:00</span>
              <span>Guided capture · 20.0 s</span>
              <span>0:20</span>
            </div>
            <svg
              className={styles.timelinePlot}
              viewBox={`0 0 ${TIMELINE_WIDTH} 54`}
              focusable="false"
              preserveAspectRatio="none"
            >
              <path
                className={styles.timelineBaseline}
                d={`M${TIMELINE_GUTTER} ${TIMELINE_BASELINE}H${
                  TIMELINE_WIDTH - TIMELINE_GUTTER
                }`}
              />
              <path className={styles.timelineTicks} d={tickPath} />
              <path className={styles.timelineTraceA} d={inputAPath} />
              <path className={styles.timelineTraceB} d={inputBPath} />
              <circle
                className={styles.timelineNodeA}
                cx={TIMELINE_GUTTER}
                cy={TIMELINE_BASELINE}
                r="5.5"
              />
              <circle
                className={styles.timelineNodeGate}
                cx={TIMELINE_GATE}
                cy={TIMELINE_BASELINE}
                r="3.5"
              />
              <circle
                className={styles.timelineNodeB}
                cx={TIMELINE_WIDTH - TIMELINE_GUTTER}
                cy={TIMELINE_BASELINE}
                r="5.5"
              />
            </svg>
            <p className={styles.timelineProtocol}>Same script · two passes</p>
          </div>
        </section>
      </main>
    </div>
  );
}
