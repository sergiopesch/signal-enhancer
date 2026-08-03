import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GUIDED_READING_CUES,
  GUIDED_READING_PASSAGE,
} from "@/lib/audio/reading-passage";

import { CaptureStage, type CapturePhase } from "../capture-stage";

afterEach(cleanup);

const callbacks = () => ({
  onStart: vi.fn(),
  onCancel: vi.fn(),
  onContinue: vi.fn(),
  onRetake: vi.fn(),
  onToggleReview: vi.fn(),
});

function expectCompletePassage(container: HTMLElement) {
  const renderedLines = Array.from(
    container.querySelectorAll<HTMLElement>(".reading-cue-text"),
    (element) => element.textContent ?? "",
  );
  const renderedPassage = renderedLines.join(" ");
  const words = renderedPassage.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];

  expect(renderedLines).toEqual(
    GUIDED_READING_CUES.flatMap((cue) => (cue.text === null ? [] : [cue.text])),
  );
  expect(renderedPassage).toBe(GUIDED_READING_PASSAGE);
  expect(words).toHaveLength(36);
  expect(
    container.querySelector('ol[aria-label="Timed reading passage"]'),
  ).not.toBeNull();
}

function stage(
  phase: CapturePhase,
  overrides: Partial<React.ComponentProps<typeof CaptureStage>> = {},
) {
  const handlers = callbacks();
  return {
    handlers,
    element: (
      <CaptureStage
        slot="A"
        deviceLabel="Studio input"
        phase={phase}
        elapsedSeconds={0}
        countdownSeconds={3}
        {...handlers}
        {...overrides}
      />
    ),
  };
}

describe("CaptureStage guided reading", () => {
  it("keeps the complete 36-word passage visible in every capture state", () => {
    const countdown = stage("countdown");
    const { container, rerender } = render(countdown.element);
    expectCompletePassage(container);

    const capturing = stage("capturing", { elapsedSeconds: 9 });
    rerender(capturing.element);
    expectCompletePassage(container);

    const complete = stage("complete", { elapsedSeconds: 20 });
    rerender(complete.element);
    expectCompletePassage(container);
  });

  it("announces countdown and active-cue capture timing", () => {
    const countdown = stage("countdown", { countdownSeconds: 2.2 });
    const { rerender } = render(countdown.element);

    expect(screen.getByText("Recording begins in 3")).not.toBeNull();
    expect(screen.getAllByText("Recording begins in")).toHaveLength(1);
    expect(
      screen.getByText("3", { selector: ".reading-countdown strong" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Stop capture" })).not.toBeNull();

    const capturing = stage("capturing", { elapsedSeconds: 9 });
    rerender(capturing.element);

    expect(
      screen.getByText("Recording Input A · Soft but clear"),
    ).not.toBeNull();
    expect(document.querySelector("output")).toBeNull();
    expect(screen.getByLabelText("Capture time remaining").tagName).toBe(
      "TIME",
    );
    expect(screen.getByLabelText("Capture time remaining").textContent).toBe(
      "11.0 seconds remain",
    );
    expect(
      document.querySelector('[data-cue="soft"][aria-current="step"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cue="soft"] .reading-cue-instruction')
        ?.textContent,
    ).toBe("Read now · Soften your voice without whispering.");
  });

  it("shows completion labels and wires every review action", () => {
    const complete = stage("complete", { elapsedSeconds: 20 });
    render(complete.element);

    expect(screen.getByText("Input A captured")).not.toBeNull();
    expect(screen.getByLabelText("Capture time remaining").textContent).toBe(
      "20.0 seconds captured",
    );

    fireEvent.click(screen.getByRole("button", { name: "Listen to Input A" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Record Input A again" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Input B" }),
    );

    expect(complete.handlers.onToggleReview).toHaveBeenCalledTimes(1);
    expect(complete.handlers.onRetake).toHaveBeenCalledTimes(1);
    expect(complete.handlers.onContinue).toHaveBeenCalledTimes(1);
    expect(complete.handlers.onStart).not.toHaveBeenCalled();
    expect(complete.handlers.onCancel).not.toHaveBeenCalled();
  });
});
