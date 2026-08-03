"use client";

import { Activity, BarChart3, Waves } from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";

import type { PlotView } from "./signal-plot";

export function ViewTabs({
  view,
  onChange,
  includeDifference = false,
  panelId,
  idPrefix,
  ariaLabel = "Signal view",
}: Readonly<{
  view: PlotView;
  onChange: (view: PlotView) => void;
  includeDifference?: boolean;
  panelId?: string;
  idPrefix?: string;
  ariaLabel?: string;
}>) {
  const generatedId = useId();
  const tabIdPrefix =
    idPrefix ?? `signal-view-${generatedId.replace(/:/g, "")}`;
  const tabRefs = useRef(new Map<PlotView, HTMLButtonElement>());
  const tabs: Array<{ id: PlotView; label: string; icon: typeof Waves }> = [
    { id: "waveform", label: "Waveform", icon: Waves },
    { id: "spectrum", label: "Spectrum", icon: BarChart3 },
    {
      id: includeDifference ? "difference" : "dynamics",
      label: includeDifference ? "Difference map" : "Dynamics",
      icon: Activity,
    },
  ];
  const selectedView = tabs.some((tab) => tab.id === view)
    ? view
    : (tabs[0]?.id ?? "waveform");

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextView = tabs[nextIndex]?.id;
    if (!nextView) return;
    onChange(nextView);
    tabRefs.current.get(nextView)?.focus();
  };

  return (
    <div className="view-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.id, node);
              else tabRefs.current.delete(tab.id);
            }}
            id={`${tabIdPrefix}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={selectedView === tab.id}
            aria-controls={panelId}
            tabIndex={selectedView === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <Icon size={19} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
