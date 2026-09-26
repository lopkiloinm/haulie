import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Haulie — neighborhood delivery",
    short_name: "Haulie",
    description:
      "A verified human at every handoff. Payment ready at delivery.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8f5",
    theme_color: "#285b40",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
