import { createHash } from "node:crypto";
import { API_PREFIX, CONNECTOR_ROUTES, LIMITS, MIN_PROTOCOL, PROTOCOL, type AckRequest, type DecisionsBatch, type DocumentsBatch, type EventsBatch, type GoodbyeRequest, type HelloRequest, type Snapshot } from "@agent-hub/protocol";
import type { Context, Hono } from "hono";
import type { HubDatabase } from "./db.ts";
import type { ServerConfig } from "./config.ts";
import { EventHub } from "./stream.ts";
import { apiError, readBody, routePath } from "./http.ts";

export interface ApiDependencies {
  db: HubDatabase;
  clock: () => number;
  config: ServerConfig;
  events: EventHub;
}

const jsonHash = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (clock: () => number) => new Date(clock()).toISOString();

export function mountConnectorApi(app: Hono, deps: ApiDependencies): void {
  const { db, clock, events } = deps;
  const route = (path: string) => `${API_PREFIX}${routePath(path)}`;
  const workspace = (id: string) => db.getWorkspace(id);
  const requireWorkspace = (c: Context, id: string) => {
    if (!workspace(id)) return apiError(c, "not_found", "workspace not found");
    return null;
  };
  const publish = (type: "workspace" | "snapshot" | "decision" | "command" | "document" | "history", ws: string, ref: string | null) => {
    events.publish({ type, workspace_id: ws, at: iso(clock), ref });
  };
  const touch = (id: string) => {
    db.markWorkspaceSeen(id, clock());
    publish("workspace", id, id);
  };

  app.get(route(CONNECTOR_ROUTES.ping.path), (c) => c.json({ protocol: PROTOCOL, min_protocol: MIN_PROTOCOL, server_time: iso(clock), version: "0.1.0" }));

  app.post(route(CONNECTOR_ROUTES.hello.path), async (c) => {
    const body = await readBody<HelloRequest>(c, "HelloRequest", 64 * 1024);
    if ("response" in body) return body.response;
    try {
      const hashes = db.hello(body.value, clock());
      publish("workspace", body.value.workspace_id, body.value.workspace_id);
      return c.json({ ...hashes, server_time: iso(clock) });
    } catch (error) {
      if ((error as { code?: string }).code === "duplicate_workspace") return apiError(c, "duplicate_workspace", (error as Error).message);
      throw error;
    }
  });

  app.post(route(CONNECTOR_ROUTES.goodbye.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    const missing = requireWorkspace(c, ws);
    if (missing) return missing;
    const body = await readBody<GoodbyeRequest>(c, "GoodbyeRequest", 16 * 1024);
    if ("response" in body) return body.response;
    if (db.goodbye(ws, body.value.session_id, clock())) publish("workspace", ws, ws);
    return c.body(null, 204);
  });

  app.put(route(CONNECTOR_ROUTES.snapshot.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    const missing = requireWorkspace(c, ws);
    if (missing) return missing;
    const body = await readBody<Snapshot>(c, "Snapshot", LIMITS.snapshotBytes);
    if ("response" in body) return body.response;
    if (body.value.workspace_id !== ws) return apiError(c, "bad_request", "snapshot.workspace_id must match the route workspace");
    touch(ws);
    db.saveSnapshot(ws, body.value, clock());
    publish("snapshot", ws, ws);
    return c.body(null, 204);
  });

  app.post(route(CONNECTOR_ROUTES.heartbeat.path), (c) => {
    const ws = c.req.param("ws") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    touch(ws);
    return c.body(null, 204);
  });

  app.put(route(CONNECTOR_ROUTES.decisions.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    const body = await readBody<DecisionsBatch>(c, "DecisionsBatch", 1024 * 1024);
    if ("response" in body) return body.response;
    touch(ws);
    const sync = db.upsertDecisions(ws, body.value.decisions, clock());
    for (const ref of new Set([...sync.changed, ...sync.pruned])) {
      publish("decision", ws, ref);
      publish("history", ws, ref);
    }
    for (const path of sync.deletedDocuments) {
      publish("document", ws, path);
      publish("history", ws, path);
    }
    return c.body(null, 204);
  });

  app.post(route(CONNECTOR_ROUTES.events.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    const body = await readBody<EventsBatch>(c, "EventsBatch", 1024 * 1024);
    if ("response" in body) return body.response;
    touch(ws);
    const cursor = db.insertEvents(ws, body.value, clock());
    return c.json({ run_id: body.value.run_id, cursor });
  });

  app.put(route(CONNECTOR_ROUTES.documents.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    const body = await readBody<DocumentsBatch>(c, "DocumentsBatch", LIMITS.documentsRequestBytes);
    if ("response" in body) return body.response;
    for (const document of body.value.documents) {
      if (Buffer.byteLength(document.content, "utf8") > LIMITS.documentBytes) return apiError(c, "payload_too_large", `${document.path} exceeds the document size limit`);
      if (jsonHash(Buffer.from(document.content, "utf8").toString("utf8")) !== document.sha256) return apiError(c, "bad_request", `sha256 mismatch for ${document.path}`);
    }
    touch(ws);
    for (const path of db.upsertDocuments(ws, body.value.documents, clock())) {
      publish("document", ws, path);
      publish("history", ws, path);
    }
    return c.body(null, 204);
  });

  app.delete(route(CONNECTOR_ROUTES.docDelete.path), (c) => {
    const ws = c.req.param("ws") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    const path = c.req.query("path");
    if (!path) return apiError(c, "bad_request", "path is required");
    touch(ws);
    if (db.deleteDocument(ws, path, clock())) publish("document", ws, path);
    return c.body(null, 204);
  });

  app.get(route(CONNECTOR_ROUTES.commands.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    touch(ws);
    const requested = Number(c.req.query("wait") ?? 0);
    const waitSeconds = Number.isFinite(requested) ? Math.max(0, Math.min(LIMITS.longPollSeconds, requested)) : 0;
    let commands = db.pollCommands(ws, clock());
    const deadline = Date.now() + waitSeconds * 1000;
    while (!commands.length && waitSeconds > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        const unsubscribe = events.subscribe((event) => { if (event.type === "command" && event.workspace_id === ws) finish(); });
        const timer = setTimeout(finish, Math.max(1, deadline - Date.now()));
      });
      commands = db.pollCommands(ws, clock());
    }
    return c.json({ commands });
  });

  app.post(route(CONNECTOR_ROUTES.ack.path), async (c) => {
    const ws = c.req.param("ws") ?? "";
    const id = c.req.param("id") ?? "";
    if (!workspace(ws)) return apiError(c, "not_found", "workspace not found");
    const body = await readBody<AckRequest>(c, "AckRequest", 16 * 1024);
    if ("response" in body) return body.response;
    touch(ws);
    const command = db.ackCommand(ws, id, body.value, clock());
    if (!command) return apiError(c, "not_found", "command not found");
    publish("command", ws, id);
    publish("history", ws, id);
    if (command.type === "answer" && command.run_id && command.decision_id) publish("decision", ws, `${command.run_id}/${command.decision_id}`);
    return c.body(null, 204);
  });
}
