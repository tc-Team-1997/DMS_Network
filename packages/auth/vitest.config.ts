import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Only pick up TypeScript test files — exclude compiled .js counterparts
    // that tsc produces alongside .ts source in src/ (those are gitignored
    // but may exist on disk after a build run).
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Point workspace packages to their TypeScript source so tests run
      // without a prior build step (`dist/` doesn't need to exist).
      // Trade-off: build regressions in @zordms/db or @zordms/config won't
      // be caught here — run `pnpm build` + the respective package's own
      // tests to validate compiled output.
      "@zordms/db": path.resolve(__dirname, "../db/src/index.ts"),
      "@zordms/config": path.resolve(__dirname, "../config/src/index.ts"),
    },
  },
});
