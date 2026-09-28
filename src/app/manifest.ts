import type { MetadataRoute } from "next";

/**
 * Lets an owner or a crew member add GroundsRoute to their phone's home
 * screen and open it without browser chrome. Crews are the reason this
 * matters: they open the app every morning from a truck.
 *
 * start_url is "/" rather than a crew or dashboard path because "/" already
 * sends a signed-in visitor to the right place for their role, and a crew
 * member who saved the icon from /c/<company-slug> would otherwise be pinned
 * to that one company's login form after signing in.
 *
 * The colours are the light theme's --brand and --background from
 * globals.css. A manifest cannot follow prefers-color-scheme.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GroundsRoute",
    short_name: "GroundsRoute",
    description: "Crew scheduling for small landscaping companies",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f5f6",
    theme_color: "#2f6b4f",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
