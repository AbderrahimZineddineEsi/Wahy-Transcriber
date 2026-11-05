import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // the golden test builds four engines over the 90 MB corpus
    testTimeout: 300_000,
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--max-old-space-size=4096"] } },
  },
});
