"use client";

/** Last resort when the root layout itself fails: no providers, no stylesheet, so it carries its own minimal styling. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "15vh auto", padding: "0 16px", color: "#171717" }}>
        <div role="alert">
          <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
          <p>Defluance could not display this page. Your notes are safe: nothing was changed.</p>
          <button type="button" onClick={reset} style={{ padding: "8px 16px", borderRadius: 6, border: 0, background: "#2563eb", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
