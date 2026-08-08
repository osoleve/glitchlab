import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["zustand"],
    },
    server: {
      port: 5173,
      proxy: {
        "/api": env.GLITCHLAB_API_TARGET || "http://127.0.0.1:8788",
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
