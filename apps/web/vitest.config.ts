import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tanstack/react-router": fileURLToPath(
        new URL("./src/compat/tanstack-router.tsx", import.meta.url),
      ),
      "@tanstack/react-start": fileURLToPath(
        new URL("./src/compat/tanstack-start.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    hookTimeout: 15_000,
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
