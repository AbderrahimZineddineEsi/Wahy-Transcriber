/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api goes to the new server (scripts/dev.sh starts it on 8120).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": process.env.WAHY_API ?? "http://127.0.0.1:8120" } },
  test: { environment: "jsdom", globals: false, setupFiles: ["./src/test/setup.ts"], exclude: ["e2e/**", "node_modules/**"] },
});
