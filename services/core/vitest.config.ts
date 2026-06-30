import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The core suite (42 files / 250 tests) is large, and each file builds its
    // own isolated in-memory SQLite app. Under vitest's parallel worker load the
    // collect phase saturates the CPU (~90s), and ~1 run in 4 a single request
    // intermittently 404s / drops a body purely from event-loop starvation — a
    // *different* test each run, always green in isolation, never reproducible in
    // production (routes mount once at boot). retry lets such an environmental
    // flake pass on a second attempt, while a genuinely broken test still fails
    // all attempts and stays red.
    retry: 2,
  },
});
