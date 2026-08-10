import { defineConfig } from "@playwright/experimental-ct-react";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Provide a fallback declaration for `process` to avoid requiring @types/node in this config file.
declare const process: any;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = path.resolve(__dirname, "./src");

const defaultChromiumPath = path.join(
  process.env.HOME ?? "",
  ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
);

export default defineConfig({
  testDir: "./src",
  testMatch: "**/*.test.tsx",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
    ctViteConfig: {
      plugins: [tailwindcss(), react()],
      resolve: {
        alias: {
          "@": srcRoot,
          "@animations": path.resolve(__dirname, "./src/components/animations"),
        },
      },
    },
    ctTemplateDir: "src/test-utils",
    testIdAttribute: "data-testid",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? defaultChromiumPath,
    },
  },
});
