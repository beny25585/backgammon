import { test, expect } from "@playwright/experimental-ct-react";
import { clientLogger } from "./logger";

test("clientLogger does not crash when Vite env is unavailable", () => {
  expect(() => clientLogger.info("hello from test")).not.toThrow();
});
