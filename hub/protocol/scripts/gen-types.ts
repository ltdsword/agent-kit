// Generates src/types.gen.ts from schemas/protocol.schema.json (the source of truth).
// `--check` fails when the committed file is stale, so CI catches schema edits without `npm run gen`.
import { readFileSync, writeFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";

const schemaPath = new URL("../schemas/protocol.schema.json", import.meta.url);
const outPath = new URL("../src/types.gen.ts", import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

// Compile a wrapper whose properties reference every $def, so each def becomes a named export.
const wrapper = {
  ...schema,
  title: "ProtocolDefs",
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(Object.keys(schema.$defs).map((k) => [k, { $ref: `#/$defs/${k}` }])),
};
for (const [k, d] of Object.entries<Record<string, unknown>>(schema.$defs)) d.title = k;

let ts = await compile(wrapper, "ProtocolDefs", {
  bannerComment: "/* Generated from schemas/protocol.schema.json by scripts/gen-types.ts. Do not edit. */",
  additionalProperties: false,
  strictIndexSignatures: true,
  format: true,
  maxItems: -1,
});
// The wrapper type itself is only a vehicle for the defs.
ts = ts.replace(/export interface ProtocolDefs \{[\s\S]*?\n\}\n/, "");

if (process.argv.includes("--check")) {
  if (readFileSync(outPath, "utf8") !== ts) {
    console.error("src/types.gen.ts is stale: run `npm run gen -w @agent-hub/protocol`");
    process.exit(1);
  }
} else {
  writeFileSync(outPath, ts);
}
