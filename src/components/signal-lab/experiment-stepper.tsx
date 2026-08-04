import { Check } from "lucide-react";

export const EXPERIMENT_STEPS = [
  "Reference",
  "Input A",
  "Input B",
  "Reveal",
  "Upgrade",
] as const;
export type ExperimentStage = (typeof EXPERIMENT_STEPS)[number];

const STEP_SHORT_LABELS: Record<ExperimentStage, string> = {
  Reference: "Ref",
  "Input A": "A",
  "Input B": "B",
  Reveal: "Reveal",
  Upgrade: "Up",
};

export function ExperimentStepper({
  stage,
}: Readonly<{ stage: ExperimentStage }>) {
  const activeIndex = EXPERIMENT_STEPS.indexOf(stage);

  return (
    <nav className="experiment-stepper" aria-label="Experiment progress">
      <ol>
        {EXPERIMENT_STEPS.map((step, index) => {
          const state =
            index < activeIndex
              ? "complete"
              : index === activeIndex
                ? "current"
                : "future";
          return (
            <li
              key={step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              <div className="step-track">
                <span className="step-node" aria-hidden="true">
                  <span className="step-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {state === "complete" ? (
                    <Check className="step-check" size={11} strokeWidth={2} />
                  ) : null}
                </span>
                <span className="step-label">
                  <span className="step-label-full">{step}</span>
                  <span className="step-label-short" aria-hidden="true">
                    {STEP_SHORT_LABELS[step]}
                  </span>
                </span>
                {index < EXPERIMENT_STEPS.length - 1 ? (
                  <span className="step-line" aria-hidden="true" />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
