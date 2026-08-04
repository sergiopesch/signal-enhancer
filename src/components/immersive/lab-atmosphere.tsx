"use client";

import { m } from "motion/react";

import {
  EXPERIMENT_STEPS,
  type ExperimentStage,
} from "@/components/signal-lab/experiment-stepper";

const CALIBRATION_POINTS = [
  [118, 142],
  [292, 774],
  [438, 224],
  [714, 866],
  [934, 126],
  [1_126, 716],
  [1_308, 286],
  [1_492, 824],
] as const;

export function LabAtmosphere({ stage }: Readonly<{ stage: ExperimentStage }>) {
  const stageIndex = EXPERIMENT_STEPS.indexOf(stage);
  const fieldOffset = (stageIndex - 2) * 34;

  return (
    <div
      aria-hidden="true"
      style={{
        inset: 0,
        opacity: 0.64,
        overflow: "hidden",
        pointerEvents: "none",
        position: "fixed",
        zIndex: -1,
      }}
    >
      <m.svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.1, ease: [0.2, 0.72, 0.2, 1] }}
        style={{ display: "block", height: "100%", width: "100%" }}
      >
        <defs>
          <radialGradient id="lab-contact-blue" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#5f88ff" stopOpacity="0.13" />
            <stop offset="0.48" stopColor="#5f88ff" stopOpacity="0.035" />
            <stop offset="1" stopColor="#0b0b0a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lab-contact-red" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ff654a" stopOpacity="0.09" />
            <stop offset="0.5" stopColor="#ff654a" stopOpacity="0.02" />
            <stop offset="1" stopColor="#0b0b0a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lab-contact-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e9e4d9" stopOpacity="0" />
            <stop offset="0.5" stopColor="#e9e4d9" stopOpacity="0.16" />
            <stop offset="1" stopColor="#e9e4d9" stopOpacity="0" />
          </linearGradient>
        </defs>

        <m.g
          animate={{ x: fieldOffset }}
          transition={{ duration: 0.62, ease: [0.2, 0.72, 0.2, 1] }}
        >
          <ellipse
            cx="1220"
            cy="382"
            rx="560"
            ry="470"
            fill="url(#lab-contact-blue)"
          />
          <ellipse
            cx="1500"
            cy="790"
            rx="440"
            ry="330"
            fill="url(#lab-contact-red)"
          />
          <path
            d="M1010 -120C1260 76 1388 250 1435 501c43 232-16 455-191 667"
            fill="none"
            stroke="url(#lab-contact-edge)"
            strokeWidth="1"
          />
          <path
            d="M1148 -92c167 180 251 357 251 532 0 210-92 407-276 591"
            fill="none"
            stroke="#5f88ff"
            strokeDasharray="2 23"
            strokeOpacity="0.08"
            strokeWidth="1"
          />
          <path
            d="M1290 111c-89 157-116 318-79 481 33 144 107 263 222 358"
            fill="none"
            stroke="#ff654a"
            strokeDasharray="1 31"
            strokeOpacity="0.07"
            strokeWidth="1"
          />
        </m.g>

        <g fill="#e9e4d9" opacity="0.1">
          {CALIBRATION_POINTS.map(([cx, cy], index) => (
            <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy})`}>
              <circle r={index % 3 === 0 ? 1.8 : 1.1} />
              <path
                d="M-8 0h4M4 0h4M0-8v4M0 4v4"
                fill="none"
                stroke="#e9e4d9"
                strokeWidth="0.65"
              />
            </g>
          ))}
        </g>

        <m.g
          key={stage}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: [0, 0.24, 0.12], scale: [0.985, 1.004, 1] }}
          transition={{ duration: 1.55, times: [0, 0.58, 1] }}
          style={{ transformOrigin: "1220px 500px" }}
        >
          <ellipse
            cx="1220"
            cy="500"
            rx="310"
            ry="454"
            fill="none"
            stroke="#e9e4d9"
            strokeDasharray="1 18"
            strokeWidth="0.8"
          />
          <ellipse
            cx="1220"
            cy="500"
            rx="224"
            ry="356"
            fill="none"
            stroke={stageIndex % 2 === 0 ? "#5f88ff" : "#ff654a"}
            strokeDasharray="68 22 2 32"
            strokeWidth="0.9"
          />
        </m.g>
      </m.svg>
    </div>
  );
}
