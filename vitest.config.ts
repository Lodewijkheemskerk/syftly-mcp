import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Map the "@/..." path alias (see tsconfig) so tests import through the same
// public paths the app uses.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  // tsconfig uses jsx:"preserve" for Next; Vitest 4 transforms with oxc, so set
  // the React automatic JSX runtime here for tests.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
