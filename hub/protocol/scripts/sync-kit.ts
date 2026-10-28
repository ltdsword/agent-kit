// The kit is installed into workspaces without hub/, so the connector carries its own copy of the
// schema. This keeps .agent-system/hub-protocol.schema.json byte-identical to the source of truth.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const src = new URL("../schemas/protocol.schema.json", import.meta.url);
const dst = new URL("../../../.agent-system/hub-protocol.schema.json", import.meta.url);
const text = readFileSync(src, "utf8");

if (process.argv.includes("--check")) {
  if (!existsSync(dst) || readFileSync(dst, "utf8") !== text) {
    console.error(".agent-system/hub-protocol.schema.json differs: run `npm run gen -w @agent-hub/protocol`");
    process.exit(1);
  }
} else {
  writeFileSync(dst, text);
}
