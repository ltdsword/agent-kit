// Contract test: every fixture validates against the $def named by its filename prefix, every
// fixture in invalid/ is rejected. The Python side (.agent-system/tests/test_hubschema.py) runs the
// same fixtures, so both validators agree on the same examples.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_ROUTES, COMPUTER_ROUTES, CONNECTOR_ROUTES, schema, USER_ROUTES, validate, type DefName } from "../src/index.ts";

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
      "AnswerRequest", "TextRequest", "DocumentMeta", "DocumentContent", "HistoryItem", "StreamEvent", "ApiError",
      "LoginRequest", "LoginResponse", "PasswordChangeRequest", "Me", "AdminUserRequest", "AdminUserResponse",
      "ComputerRegisterRequest", "ComputerRegisterResponse", "RelayRequest", "RelayResponse", "RelayStreamChunk",
      "RelayStreamEnd", "RelayCancel", "RelayHello", "RelayWorkspaces", "RelayPollResponse", "RelayFramesRequest",
      "Assertion", "WorkspaceIndexEntry"];
    const covered = new Set(valid.map(defOf));
    expect(wire.filter((d) => !covered.has(d))).toEqual([]);
  });
  it("route maps reference existing definitions", () => {
    const maps = [CONNECTOR_ROUTES, USER_ROUTES, ADMIN_ROUTES, COMPUTER_ROUTES];
    for (const routes of maps) {
      for (const route of Object.values(routes)) {
        for (const value of [route.body, route.res].filter((v): v is string => v !== undefined)) {
          const names = value.match(/[A-Z][A-Za-z0-9]*/g) ?? [];
          expect(names.filter((name) => name !== "WebSocket").every((name) => name in schema.$defs), value).toBe(true);
        }
      }
    }
  });
});
