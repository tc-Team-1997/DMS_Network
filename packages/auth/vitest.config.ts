import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@zordms/db": path.resolve(__dirname, "../db/src/index.ts"),
      "@zordms/config": path.resolve(__dirname, "../config/src/index.ts"),
    },
  },
});
