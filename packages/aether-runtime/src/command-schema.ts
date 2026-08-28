/**
 * Shape check against schemas/commands.schema.json.
 * Syntax, not economics: a miss or a float is HTTP 400, not a policy deny.
 * Policy never sees a command that failed this gate.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type BodySchema = {
  required?: string[];
};

const here = dirname(fileURLToPath(import.meta.url));
const COMMAND_BODIES = (
  JSON.parse(readFileSync(join(here, "../../../schemas/commands.schema.json"), "utf8")) as {
    commands: Record<string, BodySchema>;
  }
).commands;

const SIM_CURRENCY = new Set(["USD_SIM", "USDC_SIM"]);

export function commandBodySchema(type: string): BodySchema | undefined {
  return COMMAND_BODIES[type];
}

/** Field names listed as required that are missing, null, or empty string. */
export function missingCommandFields(type: string, body: unknown): string[] {
  const schema = COMMAND_BODIES[type];
  if (!schema) return ["type"];
  const required = schema.required ?? [];
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return required.filter((k) => {
    const v = rec[k];
    return v === undefined || v === null || v === "";
  });
}

function badInt(path: string, value: unknown, out: string[], min = 0): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value) || value < min) {
    out.push(path);
  }
}

function badMoney(path: string, value: unknown, out: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "object") {
    out.push(path);
    return;
  }
  const m = value as Record<string, unknown>;
  badInt(`${path}.amount`, m.amount, out, 0);
  if (typeof m.currency !== "string" || !SIM_CURRENCY.has(m.currency)) out.push(`${path}.currency`);
}

/** Non-integer cents, negative amounts, or a currency that is not the sim rail. */
export function malformedMoneyFields(type: string, body: unknown): string[] {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: string[] = [];
  if (type === "market.quote") {
    badMoney("price", rec.price, out);
    if (rec.fx && typeof rec.fx === "object") {
      badInt("fx.rateE6", (rec.fx as Record<string, unknown>).rateE6, out, 0);
    }
  }
  if (type === "ledger.transfer") badMoney("amount", rec.amount, out);
  if (type === "mandate.issue_cart" && Array.isArray(rec.line_items)) {
    rec.line_items.forEach((line, i) => {
      if (!line || typeof line !== "object") {
        out.push(`line_items[${i}]`);
        return;
      }
      const l = line as Record<string, unknown>;
      badMoney(`line_items[${i}].unitAmount`, l.unitAmount, out);
      badInt(`line_items[${i}].quantity`, l.quantity, out, 1);
    });
  }
  if (type === "mandate.issue_intent" && Array.isArray(rec.constraints)) {
    rec.constraints.forEach((raw, i) => {
      if (!raw || typeof raw !== "object") return;
      const c = raw as Record<string, unknown>;
      if (c.type === "payment.amount_range" || c.type === "payment.budget") {
        badInt(`constraints[${i}].max`, c.max, out, 0);
        if (c.min !== undefined) badInt(`constraints[${i}].min`, c.min, out, 0);
      }
    });
  }
  return out;
}

/** Human-readable reason, or undefined if the body is well-formed. */
export function commandShapeError(type: string, body: unknown): string | undefined {
  const missing = missingCommandFields(type, body);
  if (missing.length > 0) return `missing required fields: ${missing.join(", ")}`;
  const money = malformedMoneyFields(type, body);
  if (money.length > 0) return `invalid integer money: ${money.join(", ")}`;
  return undefined;
}
