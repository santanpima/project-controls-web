import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
