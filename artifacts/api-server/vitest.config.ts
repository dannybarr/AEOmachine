import { defineConfig } from "vitest/config";

// node:test-based suites (src/lib/*.test.ts) run via `tsx --test`;
// vitest runs only the vitest-based suites under __tests__/.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
