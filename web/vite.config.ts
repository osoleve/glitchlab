import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.GLITCHLOOM_API_TARGET ?? "http://127.0.0.1:8788",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
