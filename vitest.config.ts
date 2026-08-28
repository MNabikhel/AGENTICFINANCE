import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = (name: string) => path.resolve(__dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@aether/types": alias("aether-types"),
      "@aether/kernel": alias("aether-kernel"),
      "@aether/audit": alias("aether-audit"),
      "@aether/policy": alias("aether-policy"),
      "@aether/ledger": alias("aether-ledger"),
      "@aether/identity": alias("aether-identity"),
      "@aether/mandate": alias("aether-mandate"),
      "@aether/envelope": alias("aether-envelope"),
      "@aether/escrow": alias("aether-escrow"),
      "@aether/market": alias("aether-market"),
      "@aether/settlement": alias("aether-settlement"),
      "@aether/runtime": alias("aether-runtime"),
      "@aether/sprint": path.resolve(__dirname, "packages/aether-runtime/src/sprint-procurement.ts"),
    },
  },
});
