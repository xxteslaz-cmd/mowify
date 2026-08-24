"use client"; // Error boundaries must be Client Components.

/**
 * The last-resort boundary: it only renders when the root layout itself fails,
 * which means the font loader or globals.css may be exactly what broke. This
 * file replaces the whole document, so it must supply its own <html> and
 * <body> and cannot rely on the app's design tokens or Tailwind classes —
 * everything here is inline or in the <style> block below.
 *
 * `metadata` is not supported in a Client Component, so the tab title is set
 * with React's <title> element instead.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "var(--ge-bg)",
          color: "var(--ge-fg)",
        }}
      >
        <title>Something went wrong · GroundsRoute</title>
        {/* The app's stylesheet never loads here, so the two themes are
            defined inline against the OS preference — the only theme signal
            this document can see. */}
        <style>{`
          :root { --ge-bg:#f2f5f6; --ge-fg:#171b1a; --ge-muted:#667471; --ge-surface:#ffffff; --ge-border:#dfe5e6; --ge-brand:#2f6b4f; --ge-on-brand:#ffffff; }
          @media (prefers-color-scheme: dark) {
            :root { --ge-bg:#0f1413; --ge-fg:#e6eae8; --ge-muted:#94a09d; --ge-surface:#171d1b; --ge-border:#262e2c; --ge-brand:#62b083; --ge-on-brand:#10130f; }
          }
        `}</style>

        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            background: "var(--ge-surface)",
            border: "1px solid var(--ge-border)",
            borderRadius: "0.625rem",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "var(--ge-muted)",
            }}
          >
            GroundsRoute hit an error it couldn&apos;t recover from on its own.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1rem",
              fontSize: "1rem",
              fontWeight: 600,
              borderRadius: "0.625rem",
              border: "1px solid transparent",
              background: "var(--ge-brand)",
              color: "var(--ge-on-brand)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                color: "var(--ge-muted)",
              }}
            >
              Reference code: <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
