/**
 * Shape check against schemas/commands.schema.json.
 * Syntax, not economics: a miss, a float, a listed enum miss, a rung outside 0–5,
 * a listed field with the wrong JSON type, a nested cart line / constraint
 * missing its fields, or a listed constraint missing its value fields is HTTP 400, not a policy deny.
 * Policy never sees a command that failed this gate.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MANDATE_CONSTRAINT_TYPES, RECURRENCE_GAP_MS } from "@aether/types";

type PropSchema = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  items?: { type?: string };
};

type BodySchema = {
  required?: string[];
  properties?: Record<string, PropSchema>;
};

const here = dirname(fileURLToPath(import.meta.url));
const COMMAND_BODIES = (
  JSON.parse(readFileSync(join(here, "../../../schemas/commands.schema.json"), "utf8")) as {
    commands: Record<string, BodySchema>;
  }
).commands;

const SIM_CURRENCY = new Set(["USD_SIM", "USDC_SIM"]);
const CONSTRAINT_TYPE_SET = new Set<string>(MANDATE_CONSTRAINT_TYPES);
const RECURRENCE_SET = new Set<string>(Object.keys(RECURRENCE_GAP_MS));

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

/** Listed enum miss when the field is present (role, decision, issuerKind, currency). */
export function malformedEnumFields(type: string, body: unknown): string[] {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const props = COMMAND_BODIES[type]?.properties ?? {};
  const out: string[] = [];
  for (const [key, prop] of Object.entries(props)) {
    if (!prop.enum) continue;
    const v = rec[key];
    if (v === undefined || v === null) continue;
    if (!prop.enum.includes(v)) out.push(key);
  }
  return out;
}

/** Top-level schema integers (ladder `to`, autonomy, audit limit) outside min/max. */
export function malformedIntegerFields(type: string, body: unknown): string[] {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const props = COMMAND_BODIES[type]?.properties ?? {};
  const out: string[] = [];
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type !== "integer") continue;
    const v = rec[key];
    if (v === undefined || v === null) continue;
    const min = prop.minimum ?? Number.NEGATIVE_INFINITY;
    const max = prop.maximum ?? Number.POSITIVE_INFINITY;
    if (typeof v !== "number" || !Number.isInteger(v) || !Number.isFinite(v) || v < min || v > max) {
      out.push(key);
    }
  }
  return out;
}

/** Listed JSON type miss when the field is present (string id, array, object). */
export function malformedTypeFields(type: string, body: unknown): string[] {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const props = COMMAND_BODIES[type]?.properties ?? {};
  const out: string[] = [];
  for (const [key, prop] of Object.entries(props)) {
    const v = rec[key];
    if (v === undefined || v === null) continue;
    if (prop.enum) continue;
    if (prop.type === "integer") continue;
    if (prop.type === "string" && typeof v !== "string") out.push(key);
    if (prop.type === "object" && (typeof v !== "object" || Array.isArray(v))) out.push(key);
    if (prop.type === "array") {
      if (!Array.isArray(v)) {
        out.push(key);
        continue;
      }
      if (typeof prop.minItems === "number" && v.length < prop.minItems) out.push(key);
      if (prop.items?.type === "string" && v.some((item) => typeof item !== "string")) out.push(key);
    }
  }
  return out;
}

function malformedObjectIdList(value: unknown, path: string, out: string[]): void {
  if (!Array.isArray(value)) {
    out.push(path);
    return;
  }
  value.forEach((item, j) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      out.push(`${path}[${j}]`);
      return;
    }
    const id = (item as Record<string, unknown>).id;
    if (typeof id !== "string" || id.length === 0) out.push(`${path}[${j}].id`);
  });
}

function malformedStringList(value: unknown, path: string, out: string[]): void {
  if (!Array.isArray(value)) {
    out.push(path);
    return;
  }
  value.forEach((item, j) => {
    if (typeof item !== "string") out.push(`${path}[${j}]`);
  });
}

function malformedConstraintFields(c: Record<string, unknown>, i: number, out: string[]): void {
  const p = (field: string) => `constraints[${i}].${field}`;
  if (typeof c.type !== "string" || c.type.length === 0 || !CONSTRAINT_TYPE_SET.has(c.type)) {
    out.push(p("type"));
    return;
  }
  switch (c.type) {
    case "payment.amount_range":
    case "payment.budget":
      if (typeof c.currency !== "string" || !SIM_CURRENCY.has(c.currency)) out.push(p("currency"));
      if (c.max === undefined || c.max === null) out.push(p("max"));
      break;
    case "payment.allowed_payees":
    case "payment.allowed_payment_instruments":
      malformedObjectIdList(c.allowed, p("allowed"), out);
      break;
    case "payment.agent_recurrence":
      if (typeof c.frequency !== "string" || !RECURRENCE_SET.has(c.frequency)) out.push(p("frequency"));
      break;
    case "payment.execution_date": {
      const before = c.not_before;
      const after = c.not_after;
      if (before !== undefined && before !== null && typeof before !== "string") out.push(p("not_before"));
      if (after !== undefined && after !== null && typeof after !== "string") out.push(p("not_after"));
      if ((before === undefined || before === null) && (after === undefined || after === null)) {
        out.push(p("not_before"));
        out.push(p("not_after"));
      }
      break;
    }
    case "payment.reference":
      if (typeof c.conditional_transaction_id !== "string" || c.conditional_transaction_id.length === 0) {
        out.push(p("conditional_transaction_id"));
      }
      break;
    case "aether.allowed_skus":
      malformedStringList(c.allowed, p("allowed"), out);
      break;
    case "aether.max_autonomy":
      if (
        typeof c.max !== "number" ||
        !Number.isInteger(c.max) ||
        !Number.isFinite(c.max) ||
        c.max < 0 ||
        c.max > 5
      ) {
        out.push(p("max"));
      }
      break;
    default:
      out.push(p("type"));
  }
}

/** Nested objects the kernel totals or hashes: cart lines and intent constraints. */
export function malformedNestedFields(type: string, body: unknown): string[] {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: string[] = [];
  if (type === "mandate.issue_cart" && Array.isArray(rec.line_items)) {
    rec.line_items.forEach((line, i) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        out.push(`line_items[${i}]`);
        return;
      }
      const l = line as Record<string, unknown>;
      if (typeof l.sku !== "string" || l.sku.length === 0) out.push(`line_items[${i}].sku`);
      if (typeof l.description !== "string") out.push(`line_items[${i}].description`);
      if (l.quantity === undefined || l.quantity === null) out.push(`line_items[${i}].quantity`);
      if (l.unitAmount === undefined || l.unitAmount === null) out.push(`line_items[${i}].unitAmount`);
    });
  }
  if (type === "mandate.issue_intent" && Array.isArray(rec.constraints)) {
    rec.constraints.forEach((raw, i) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        out.push(`constraints[${i}]`);
        return;
      }
      malformedConstraintFields(raw as Record<string, unknown>, i, out);
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
  const enums = malformedEnumFields(type, body);
  if (enums.length > 0) return `invalid enum: ${enums.join(", ")}`;
  const ints = malformedIntegerFields(type, body);
  if (ints.length > 0) return `invalid integer: ${ints.join(", ")}`;
  const types = malformedTypeFields(type, body);
  if (types.length > 0) return `invalid type: ${types.join(", ")}`;
  const nested = malformedNestedFields(type, body);
  if (nested.length > 0) return `invalid nested: ${nested.join(", ")}`;
  return undefined;
}
