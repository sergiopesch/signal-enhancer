import { Activity, BarChart3, Waves } from "lucide-react";

import type { PlotView } from "./signal-plot";

export function ModeSwitch({
  mode,
  onChange,
}: Readonly<{
  mode: "absolute" | "matched";
  onChange: (mode: "absolute" | "matched") => void;
}>) {
  return (
    <div
      className="segmented-control mode-switch"
      role="group"
      aria-label="Comparison level mode"
    >
      <button
        type="button"
        aria-pressed={mode === "absolute"}
        onClick={() => onChange("absolute")}
      >
        Absolute
      </button>
      <button
        type="button"
        aria-pressed={mode === "matched"}
        onClick={() => onChange("matched")}
      >
        Loudness matched
      </button>
    </div>
  );
}

export function ViewTabs({
  view,
  onChange,
  includeDifference = false,
}: Readonly<{
  view: PlotView;
  onChange: (view: PlotView) => void;
  includeDifference?: boolean;
}>) {
  const tabs: Array<{ id: PlotView; label: string; icon: typeof Waves }> = [
    { id: "waveform", label: "Waveform", icon: Waves },
    { id: "spectrum", label: "Spectrum", icon: BarChart3 },
    {
      id: includeDifference ? "difference" : "dynamics",
      label: includeDifference ? "Difference map" : "Dynamics",
      icon: Activity,
    },
  ];

  return (
    <div className="view-tabs" role="tablist" aria-label="Signal view">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={19} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
