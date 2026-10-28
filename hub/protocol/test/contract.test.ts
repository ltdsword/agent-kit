// Contract test: every fixture validates against the $def named by its filename prefix, every
// fixture in invalid/ is rejected. The Python side (.agent-system/tests/test_hubschema.py) runs the
// same fixtures, so both validators agree on the same examples.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schema, validate, type DefName } from "../src/index.ts";

const dir = new URL("../fixtures/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const defOf = (f: string) => f.split("/").pop()!.split(".")[0] as DefName;
const valid = readdirSync(dir).filter((f) => f.endsWith(".json"));
const invalid = readdirSync(new URL("invalid/", dir)).map((f) => `invalid/${f}`);

describe("protocol fixtures", () => {
  it.each(valid)("%s is valid", (f) => {
    expect(defOf(f) in schema.$defs, `no $def ${defOf(f)}`).toBe(true);
    expect(validate(defOf(f), load(f))).toEqual({ ok: true });
  });
  it.each(invalid)("%s is rejected", (f) => {
    expect(validate(defOf(f), load(f)).ok).toBe(false);
  });
  it("covers every message sent over the wire", () => {
    const wire: DefName[] = ["Snapshot", "Decision", "DecisionsBatch", "EventsBatch", "EventsResponse",
      "DocumentsBatch", "HelloRequest", "HelloResponse", "GoodbyeRequest", "Command", "CommandsResponse",
      "AckRequest", "PingResponse", "WorkspaceSummary", "WorkspaceDetail", "HubDecision", "UserCommand",
      "AnswerRequest", "TextRequest", "DocumentMeta", "DocumentContent", "HistoryItem", "Device",
      "PairRequest", "PairResponse", "StreamEvent", "ApiError"];
    const covered = new Set(valid.map(defOf));
    expect(wire.filter((d) => !covered.has(d))).toEqual([]);
  });
});
