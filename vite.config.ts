import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: false,
    chunkSizeWarningLimit: 650,
  },
  server: {
    proxy: {
      "/api/": "http://localhost:3000",
      "/auth/": "http://localhost:3000",
      "/health/": "http://localhost:3000",
    },
  },
});
