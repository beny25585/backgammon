import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = path.resolve(__dirname, "./src");
const versionMarker = "__BACKGAMMON_BUILD_VERSION__";

function releaseVersion(): Plugin {
  const version = process.env.VITE_BACKGAMMON_BUILD_VERSION?.trim() || randomUUID();
  return {
    name: "backgammon-release-version",
    apply: "build",
    config() {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(version)) {
        throw new Error("Invalid Backgammon build version");
      }
      return { define: { [versionMarker]: JSON.stringify(version) } };
    },
    generateBundle() {
      const worker = readFileSync(path.resolve(__dirname, "service-worker.js"), "utf8");
      const placeholder = JSON.stringify(versionMarker);
      if (!worker.includes(placeholder)) this.error("Backgammon service worker version placeholder is missing");
      this.emitFile({ type: "asset", fileName: "sw.js", source: worker.replace(placeholder, JSON.stringify(version)) });
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version }) + "\n" });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "mobile" ? "/" : "/6b/backgammon/",
  define: { [versionMarker]: JSON.stringify("") },
  plugins: [tailwindcss(), react(), mode !== "mobile" && releaseVersion()],
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
      "/tournaments-api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tournaments-api/, "/api"),
      },
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
    outDir: mode === "mobile" ? "../mobile/dist" : "dist",
    emptyOutDir: mode === "mobile" ? true : undefined,
    sourcemap: false,
  },
}));
