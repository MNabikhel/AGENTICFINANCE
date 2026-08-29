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
      "@aether/clearing": alias("aether-clearing"),
      "@aether/kya": alias("aether-kya"),
      "@aether/runtime": alias("aether-runtime"),
      "@aether/sprint": path.resolve(__dirname, "packages/aether-runtime/src/sprint-procurement.ts"),
      "@aether/night-watch": path.resolve(__dirname, "packages/aether-runtime/src/night-watch.ts"),
      "@aether/sub-hire": path.resolve(__dirname, "packages/aether-runtime/src/sub-hire.ts"),
      "@aether/clearing-window": path.resolve(__dirname, "packages/aether-runtime/src/clearing-window.ts"),
      "@aether/refund": path.resolve(__dirname, "packages/aether-runtime/src/refund.ts"),
      "@aether/replay": path.resolve(__dirname, "packages/aether-runtime/src/replay.ts"),
      "@aether/envelope-nonce": path.resolve(__dirname, "packages/aether-runtime/src/envelope-nonce.ts"),
    },
  },
});
