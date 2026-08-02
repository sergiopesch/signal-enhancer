import { Check } from "lucide-react";

export const EXPERIMENT_STEPS = [
  "Reference",
  "Input A",
  "Input B",
  "Reveal",
  "Upgrade",
] as const;
export type ExperimentStage = (typeof EXPERIMENT_STEPS)[number];

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
              <div className="step-track" aria-hidden="true">
                <span className="step-node">
                  {index + 1}
                  {state === "complete" ? (
                    <Check className="step-check" size={11} strokeWidth={2} />
                  ) : null}
                </span>
                {index < EXPERIMENT_STEPS.length - 1 ? (
                  <span className="step-line" />
                ) : null}
              </div>
              <span
                className="step-label"
                data-short={step.replace("Input ", "")}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
