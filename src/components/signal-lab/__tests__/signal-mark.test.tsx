import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SignalMark } from "../signal-mark";

afterEach(cleanup);

describe("SignalMark", () => {
  it("keeps both input identities separate across one enhancement gate", () => {
    const { container } = render(<SignalMark />);
    const mark = container.querySelector(".signal-mark");

    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelectorAll(".signal-mark-input")).toHaveLength(2);
    expect(mark?.querySelectorAll(".signal-mark-output")).toHaveLength(2);
    expect(mark?.querySelectorAll(".signal-mark-trace-a")).toHaveLength(2);
    expect(mark?.querySelectorAll(".signal-mark-trace-b")).toHaveLength(2);
    expect(mark?.querySelectorAll(".signal-mark-enhancer")).toHaveLength(1);
    expect(mark?.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 64 40",
    );
    expect(
      mark?.querySelector(".signal-mark-enhancer")?.getAttribute("d"),
    ).toBe("M32 1V39");
  });

  it("retains its compact rendering contract", () => {
    const { container } = render(<SignalMark compact />);

    expect(
      container.querySelector(".signal-mark")?.hasAttribute("data-compact"),
    ).toBe(true);
  });
});
