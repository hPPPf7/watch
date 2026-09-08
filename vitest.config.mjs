import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    server: { deps: { inline: ["next-auth"] } },
  },
  resolve: {
    alias: {
      "@": path.resolve("src"),
    },
  },
});
