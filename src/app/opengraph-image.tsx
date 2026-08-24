import { ImageResponse } from "next/og";

export const alt =
  "GroundsRoute — crew scheduling for small landscaping companies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colours are hard-coded here, which is the one place that is correct. This
// image is rendered by satori into a PNG on the server, not by a browser: it
// never loads globals.css, so the `--brand` custom properties the rest of the
// app uses simply do not resolve. The values below are copied from the light
// theme in globals.css and must be updated alongside it.
const BRAND = "#2f6b4f";
const BRAND_SOFT = "#e8f0ea";
const SURFACE = "#ffffff";
const FOREGROUND = "#171b1a";
const MUTED = "#667471";
const BORDER = "#dfe5e6";

/**
 * The card shown when someone shares a GroundsRoute link. Landscaping owners
 * pass software around by text message and in Facebook groups, so this is the
 * first thing most prospects see of the product — it mirrors the landing
 * page's two-column hero rather than showing a bare logo.
 *
 * satori is stricter than a browser: any element with more than one child
 * needs an explicit `display`, and any character outside the bundled font
 * triggers a network font fetch that fails the build. Both rules are why this
 * markup looks more verbose than the equivalent component.
 */
export default function Image() {
  // Uneven stop counts on purpose, so the board reads as a real day's work
  // rather than a symmetrical grid.
  const columns = [3, 2, 3];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          backgroundColor: SURFACE,
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: BRAND,
                display: "flex",
              }}
            />
            <div style={{ fontSize: 28, fontWeight: 600, color: BRAND }}>
              GroundsRoute
            </div>
          </div>

          <div
            style={{
              fontSize: 60,
              fontWeight: 600,
              color: FOREGROUND,
              marginTop: 32,
              lineHeight: 1.12,
            }}
          >
            The day, planned on one board.
          </div>

          <div style={{ fontSize: 27, color: MUTED, marginTop: 22, lineHeight: 1.35 }}>
            Crew scheduling for small landscaping companies.
          </div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {columns.map((stops, colIndex) => (
            <div
              key={colIndex}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                width: 140,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: BRAND,
                    display: "flex",
                  }}
                />
                <div style={{ fontSize: 17, fontWeight: 600, color: MUTED }}>
                  {`Crew ${colIndex + 1}`}
                </div>
              </div>
              {Array.from({ length: stops }).map((_, i) => {
                // One completed stop, so the card shows work being closed out
                // and not just a list of things still to do.
                const done = colIndex === 0 && i === 0;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 9,
                      border: `2px solid ${done ? BRAND_SOFT : BORDER}`,
                      backgroundColor: done ? BRAND_SOFT : SURFACE,
                      color: done ? BRAND : FOREGROUND,
                      padding: "12px 13px",
                      fontSize: 17,
                    }}
                  >
                    {/* A drawn dot rather than a "✓" glyph: satori falls back
                        to downloading a font for any character outside the
                        bundled set, which fails the build on a machine with no
                        network access to Google Fonts. */}
                    {done && (
                      <div
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 6,
                          backgroundColor: BRAND,
                          display: "flex",
                        }}
                      />
                    )}
                    <div style={{ display: "flex" }}>{`Stop ${i + 1}`}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
