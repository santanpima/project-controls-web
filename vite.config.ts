import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// TEMPORARY, LOCAL-DEVELOPMENT-ONLY WORKAROUND — not the real production
// architecture. The backend Cloud Run service can't be made public because
// of an organization-level security policy (confirmed directly against
// Google's own IAM policy troubleshooter, not assumed). Rather than fight
// that policy, this proxies /api requests through the Vite dev server
// itself, which runs on this machine and can attach a real Google identity
// token from `gcloud auth print-identity-token` — the same credential the
// earlier curl tests used successfully. The browser only ever talks to
// this dev server (same-origin, so CORS never even applies here), never to
// Google Cloud directly.
//
// The real production answer, for later: the frontend's own Cloud Run
// service (once deployed) should call the backend using its own runtime
// service account's identity, granted Cloud Run Invoker specifically for
// that one service account — not allUsers. Org policies restricting public
// access almost always still allow a specific, named service account to be
// granted access; it's the "expose to the entire internet" grant that's
// restricted, not service-to-service calls within the same org. That's a
// real, separate piece of work for when the frontend is actually deployed.
//
// PASTE_YOUR_TOKEN_HERE expires after about an hour — if requests start
// failing again later, just run `gcloud auth print-identity-token` again
// and paste the new value in.
const GCLOUD_IDENTITY_TOKEN = "PASTE_YOUR_TOKEN_HERE";

// Path aliases (@features/*, @shared/*, @app/*) per 4.1.1.2.1 — mirrored in
// tsconfig.json below so the editor and the bundler always agree on module
// resolution, exactly as specified.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@features": path.resolve(__dirname, "./src/features"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@app": path.resolve(__dirname, "./src/app"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://backend-api-953962114781.us-central1.run.app",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Authorization", `Bearer ${GCLOUD_IDENTITY_TOKEN}`);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
