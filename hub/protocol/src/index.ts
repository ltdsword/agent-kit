// @agent-hub/protocol: the one contract between the connector, the backend and the web UI.
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/protocol.schema.json" with { type: "json" };

export * from "./types.gen.ts";
export * from "./api.ts";
export { schema };

export type DefName = keyof typeof schema.$defs;
export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const ajv = new Ajv2020.default({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(schema);

/** Validate `data` against one $def; errors read like `/decisions/0/decision_id must match pattern ...`. */
export function validate(def: DefName, data: unknown): ValidationResult {
  const check = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
  if (!check) throw new Error(`unknown protocol definition ${def}`);
  if (check(data)) return { ok: true };
  return { ok: false, errors: (check.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`) };
}
