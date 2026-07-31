"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="reader-state">
      <h1>Something went wrong</h1>
      <p>Folio could not finish that action. Your on-device library has not been removed.</p>
      <button className="primary-button" onClick={reset}>Try again</button>
    </main>
  );
}
