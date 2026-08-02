"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="fault-page">
      <div className="fault-mark" aria-hidden="true">
        <AlertTriangle size={22} />
      </div>
      <p className="instrument-label">Signal interrupted</p>
      <h1>The lab lost its place.</h1>
      <p>
        Your recordings have not been uploaded. Reload the instrument and begin
        again.
      </p>
      <button className="button button-primary" type="button" onClick={reset}>
        <RotateCcw size={17} />
        Restore the lab
      </button>
    </main>
  );
}
