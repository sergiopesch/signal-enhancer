import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="fault-page">
      <p className="instrument-label">404 · Outside the signal path</p>
      <h1>There is no instrument here.</h1>
      <p>Return to the Input Chain Fingerprint experiment.</p>
      <Link className="button button-primary" href="/">
        Return to the lab
      </Link>
    </main>
  );
}
