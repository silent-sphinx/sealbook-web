import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "SEALBOOK_");
  const devHost = env.SEALBOOK_DEV_HOST || "localhost";
  const devPort = Number(env.SEALBOOK_DEV_PORT) || 5173;
  const apiTarget = env.SEALBOOK_API_TARGET || "https://127.0.0.1:8443";

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [
      {
        name: "sealbook-dev-csp",
        transformIndexHtml(html, context) {
          if (!context.server) {
            return html;
          }

          return html.replace(
            "script-src 'self' 'wasm-unsafe-eval'",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
          );
        },
      },
      react(),
      tailwindcss(),
      basicSsl(),
      VitePWA({
        // "prompt", not "autoUpdate": an auto-updating worker calls skipWaiting
        // and claims open tabs as soon as a new build lands, while those tabs are
        // still running the previous bundle. Their lazy chunks are gone from both
        // the new precache and the server, so the next dynamic import fails. On
        // "prompt" the new worker waits, the old one keeps serving the assets its
        // tab was built against, and `UpdatePrompt` offers the reload.
        registerType: "prompt",
        // Registration happens in app code through `virtual:pwa-register/react`,
        // so the generated registerSW.js script is not injected as well.
        injectRegister: null,
        includeAssets: [
          "favicon.png",
          "pwa-192x192.png",
          "pwa-512x512.png",
          "apple-touch-icon.png",
        ],
        manifest: {
          name: "Sealbook",
          short_name: "Sealbook",
          description: "Private contacts and calendar, secured by your device.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          theme_color: "#161616",
          background_color: "#161616",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          // The wasm core is past workbox's 2 MiB default, and the app cannot start offline without it.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/v1\//, /^\/health$/],
        },
      }),
    ],
    server: {
      port: devPort,
      host: devHost,
      hmr: {
        host: devHost,
        protocol: "wss",
        clientPort: devPort,
      },
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' https: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
      proxy: {
        "/v1": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
        "/health": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
