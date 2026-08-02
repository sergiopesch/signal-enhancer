import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Signal Enhancer",
    short_name: "Signal Enhancer",
    description: "One sound, two input chains, one honest signal upgrade.",
    start_url: "/",
    display: "standalone",
    background_color: "#050b0f",
    theme_color: "#050b0f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
