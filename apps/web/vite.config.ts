import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["apple-touch-icon.png"],
      // Browsers fetch the manifest without cookies by default, but Access requires its cookie.
      useCredentials: true,
      manifest: {
        name: "Tare",
        short_name: "Tare",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#234b40",
        background_color: "#f6f4eb",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/api(?:[/?]|$)/,
          /^\/mcp(?:[/?]|$)/,
          /^\/health(?:[/?]|$)/,
          /^\/cdn-cgi\//,
        ],
        runtimeCaching: [],
        manifestTransforms: [
          async (entries) => ({
            manifest: await Promise.all(
              entries.map(async (entry) => ({
                ...entry,
                integrity: `sha384-${createHash("sha384")
                  .update(
                    await readFile(
                      fileURLToPath(
                        new URL(`./dist/${entry.url}`, import.meta.url),
                      ),
                    ),
                  )
                  .digest("base64")}`,
              })),
            ),
            warnings: [],
          }),
        ],
      },
    }),
  ],
});
