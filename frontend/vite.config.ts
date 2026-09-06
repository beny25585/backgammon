import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = path.resolve(__dirname, "./src");

export default defineConfig({
  base: "/backgammon/",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": srcRoot,
      "@animations": path.resolve(__dirname, "./src/components/animations"),
    },
  },
  optimizeDeps: {
    rolldownOptions: {
      resolve: {
        alias: {
          "@": srcRoot,
          "@animations": path.resolve(__dirname, "./src/components/animations"),
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    allowedHosts: ["morphotonemic-compellably-roselee.ngrok-free.dev"],
    proxy: {
  "/backgammon/api": {
    target: "http://localhost:8000",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/backgammon/, ""),
  },
  "/backgammon/ws": {
    target: "ws://localhost:8000",
    ws: true,
    rewrite: (path) => path.replace(/^\/backgammon/, ""),
  },
    
    },
    watch: {
      usePolling: true,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
