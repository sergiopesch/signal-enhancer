import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="fault-page">
      <p className="instrument-label">404 · Outside the signal path</p>
      <h1>There is no instrument here.</h1>
      <p>Return to Signal Enhancer’s comparison lab.</p>
      <Link className="button button-primary" href="/lab">
        Return to the lab
      </Link>
    </main>
  );
}
