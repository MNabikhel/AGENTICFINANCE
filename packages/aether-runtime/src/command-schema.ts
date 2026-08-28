/**
 * Required-field check against schemas/commands.schema.json.
 * Syntax, not economics: a miss is HTTP 400, not a policy deny.
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
