import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = path.resolve(__dirname, "./src");

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": srcRoot,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      alias: {
        "@": srcRoot,
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    allowedHosts: ["morphotonemic-compellably-roselee.ngrok-free.dev"],
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
