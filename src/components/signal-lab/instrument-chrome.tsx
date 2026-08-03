import type { ReactNode } from "react";

type InstrumentDatum = {
  label: string;
  value: ReactNode;
};

export function InstrumentRegistration() {
  return (
    <div className="instrument-registration" aria-hidden="true">
      <i data-corner="north-west" />
      <i data-corner="north-east" />
      <i data-corner="south-west" />
      <i data-corner="south-east" />
    </div>
  );
}

export function InstrumentMetadata({
  label,
  items,
}: Readonly<{
  label: string;
  items: readonly InstrumentDatum[];
}>) {
  return (
    <dl className="instrument-metadata" aria-label={label}>
      {items.map((item) => (
        <div className="instrument-metadata-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
