import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/auth": "http://localhost:4000", "/users": "http://localhost:4000", "/authz": "http://localhost:4000", "/health": "http://localhost:4000" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], environmentOptions: { jsdom: { url: "http://localhost" } } },
});
