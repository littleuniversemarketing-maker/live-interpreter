import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Real-Time Interpreter",
        short_name: "Interpreter",
        description: "Live bidirectional voice translation — works offline once set up.",
        start_url: "/",
        display: "standalone",
        background_color: "#12181f",
        theme_color: "#12181f",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell (JS/CSS/HTML/icons) is precached so the app opens with
        // zero network — this is the "tap the icon, it opens" requirement.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        // ONNX model weights and WASM runtime files come from the HF CDN at
        // runtime (via @huggingface/transformers), not from our own build —
        // cache them permanently once downloaded so offline mode survives a
        // reload without re-fetching hundreds of MB.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith("huggingface.co") || url.hostname.endsWith("jsdelivr.net"),
            handler: "CacheFirst",
            options: {
              cacheName: "offline-ml-models",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // ONNX Runtime Web's own WASM binary (~26MB) is bundled as a
            // same-origin asset by the build, not fetched from the HF CDN —
            // it needs its own cache-first rule or it re-downloads every
            // time the app is opened without a network connection.
            urlPattern: ({ url }) => url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: {
              cacheName: "offline-ml-runtime",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Don't let the service worker try to precache multi-hundred-MB
        // model files even if one ever ends up same-origin.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/ws/interpreter": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
