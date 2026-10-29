import { API_PREFIX, ERRORS, LIMITS, USER_ROUTES, type AnswerRequest, type TextRequest } from "@agent-hub/protocol";
import type { Context, Hono } from "hono";
import type { HubDatabase, Row } from "./db.ts";
import type { ServerConfig } from "./config.ts";
import { assertionFrom, requireAssertion, verifyAssertion, type AssertionVerifier } from "./auth.ts";
import { apiError, readBody, routePath } from "./http.ts";
import { EventHub } from "./stream.ts";
import { historyItems, hubDecision, workspaceDetail, workspaceSummary } from "./status.ts";

export interface UserApiDependencies {
  db: HubDatabase;
  clock: () => number;
  config: ServerConfig;
  events: EventHub;
  assertionVerifier?: AssertionVerifier;
}

type Sortable = { _sort: Array<string | number>; [key: string]: unknown };
function compareSort(a: Array<string | number>, b: Array<string | number>): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? "";
    const right = b[index] ?? "";
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}
function encodeCursor(sort: Array<string | number>): string { return Buffer.from(JSON.stringify(sort)).toString("base64url"); }
function decodeCursor(cursor: string): Array<string | number> | undefined {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(value) ? value as Array<string | number> : undefined;
  } catch { return undefined; }
}
function page<T extends Sortable>(items: T[], cursor: string | undefined) {
  const sorted = items.sort((a, b) => compareSort(a._sort, b._sort));
  const after = cursor ? decodeCursor(cursor) : undefined;
  const remaining = after ? sorted.filter((item) => compareSort(item._sort, after) > 0) : sorted;
  const selected = remaining.slice(0, 50);
  const hasMore = remaining.length > selected.length;
  return { items: selected.map(({ _sort: _sort, ...item }) => item), next: hasMore && selected.length ? encodeCursor(selected[selected.length - 1]._sort) : null };
}
function clean<T extends Sortable>(items: T[]): Omit<T, "_sort">[] { return items.map(({ _sort: _sort, ...item }) => item); }
function requireWorkspace(db: HubDatabase, c: Context, ws: string): Row | Response {
  const row = db.getWorkspace(ws);
  return row ?? apiError(c, "not_found", "workspace not found");
}
export function mountUserApi(app: Hono, deps: UserApiDependencies): void {
  const { db, clock, config, events } = deps;
  const route = (path: string) => `${API_PREFIX}${routePath(path)}`;
  const verifier = deps.assertionVerifier ?? ((token, relayFrameId, now) => config.computer
    ? verifyAssertion(token, config.computer, now, relayFrameId)
    : null);
  const requireAuth = requireAssertion(verifier, clock);
  const publish = (type: "workspace" | "command" | "decision" | "history", ws: string, ref: string | null) => events.publish({ type, workspace_id: ws, at: new Date(clock()).toISOString(), ref });

  // Live updates for the proxy's `GET /computers/:c/stream`: named SSE events, one per published change.
  app.get(`${API_PREFIX}/stream`, requireAuth, (c) => {
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { cleanup(); } };
        const unsubscribe = events.subscribe((event) => send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        // Comment lines keep idle relays and proxies from closing the stream.
        const keepalive = setInterval(() => send(": keepalive\n\n"), 20_000);
        cleanup = () => { unsubscribe(); clearInterval(keepalive); };
        send(": connected\n\n");
        c.req.raw.signal.addEventListener("abort", () => { cleanup(); try { controller.close(); } catch {} }, { once: true });
      },
      cancel() { cleanup(); },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
  });

  app.get(route(USER_ROUTES.workspaces.path), requireAuth, (c) => {
    const archived = c.req.query("archived") === "true";
    const cursor = c.req.query("cursor");
    const all = c.req.query("all") === "true";
    const items = db.listWorkspaces(archived, clock(), config.recentDays ?? 15, all).map((row) => {
      const summary = workspaceSummary(db, row, config.kitVersion);
      return { ...summary, _sort: [summary.status === "ONLINE" ? 0 : 1, -(Date.parse(summary.last_seen_at ?? "1970-01-01T00:00:00Z")), summary.id] };
    });
    return c.json(page(items, cursor));
  });

  app.get(route(USER_ROUTES.workspace.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    const row = requireWorkspace(db, c, ws);
    if (row instanceof Response) return row;
    return c.json(workspaceDetail(db, row, config.kitVersion));
  });

  app.patch(route(USER_ROUTES.archive.path), requireAuth, async (c) => {
    const ws = c.req.param("ws") ?? "";
    const row = requireWorkspace(db, c, ws);
    if (row instanceof Response) return row;
    if (!(c.req.header("Content-Type") ?? "").toLowerCase().startsWith("application/json")) return apiError(c, "bad_request", "Content-Type must be application/json");
    if (Number(c.req.header("Content-Length") ?? 0) > 16 * 1024) return apiError(c, "payload_too_large", "request body exceeds the allowed size");
    const raw = await c.req.raw.text();
    if (Buffer.byteLength(raw, "utf8") > 16 * 1024) return apiError(c, "payload_too_large", "request body exceeds the allowed size");
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return apiError(c, "bad_request", "request body must be valid JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { archived?: unknown }).archived !== "boolean") {
      return apiError(c, "bad_request", "body must contain only an archived boolean");
    }
    const archived = (body as { archived: boolean }).archived;
    const assertion = assertionFrom(c);
    if (db.updateArchived(ws, archived, clock())) db.audit(ws, assertion.sub, "workspace.archived", ws, { archived }, clock());
    publish("workspace", ws, ws);
    return c.json(workspaceSummary(db, db.getWorkspace(ws)!, config.kitVersion));
  });

  app.get(route(USER_ROUTES.decisions.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    const workspace = requireWorkspace(db, c, ws);
    if (workspace instanceof Response) return workspace;
    const status = c.req.query("status");
    const run = c.req.query("run");
    const cursor = c.req.query("cursor");
    let items = db.listDecisionBodies(ws).map((decision) => {
      const derived = hubDecision(db, ws, decision);
      return { ...derived, _sort: [-Date.parse(decision.opened_at), decision.run_id, decision.decision_id] };
    });
    if (status) items = items.filter((item) => item.hub_status === status);
    if (run) items = items.filter((item) => item.decision.run_id === run);
    return c.json(page(items, cursor));
  });

  app.get(route(USER_ROUTES.decision.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    const workspace = requireWorkspace(db, c, ws);
    if (workspace instanceof Response) return workspace;
    const decision = db.getDecisionBody(ws, c.req.param("run") ?? "", c.req.param("id") ?? "");
    return decision ? c.json(hubDecision(db, ws, decision)) : apiError(c, "not_found", "decision not found");
  });

  app.post(route(USER_ROUTES.answer.path), requireAuth, async (c) => {
    const ws = c.req.param("ws") ?? "";
    const row = requireWorkspace(db, c, ws);
    if (row instanceof Response) return row;
    const body = await readBody<AnswerRequest>(c, "AnswerRequest", 32 * 1024);
    if ("response" in body) return body.response;
    const runId = c.req.param("run") ?? "";
    const decisionId = c.req.param("id") ?? "";
    const decision = db.getDecisionBody(ws, runId, decisionId);
    if (!decision) return apiError(c, "not_found", "decision not found");
    const state = hubDecision(db, ws, decision);
    if (state.hub_status !== "OPEN" && state.hub_status !== "REJECTED") {
      // The same person sending the same answer again (a repeated request) gets the existing command, not an error.
      const previous = db.latestAnswerCommand(ws, runId, decisionId);
      if (previous && previous.status !== "REJECTED" && previous.by === assertionFrom(c).sub
          && previous.body.choice === body.value.choice && previous.body.followup === body.value.followup) {
        return c.json(previous, 200);
      }
      return apiError(c, "decision_not_answerable", "decision is not open or rejected");
    }
    if (!decision.options.some((option) => option.key === body.value.choice)) return apiError(c, "invalid_option", "choice is not one of the decision options");
    let selectedFollowupValue: string | undefined;
    const followup = decision.followup;
    if (followup?.when.includes(body.value.choice)) {
      if (!body.value.followup) return apiError(c, "invalid_option", "a followup choice is required");
      const option = followup.options.find((candidate) => candidate.key === body.value.followup);
      if (!option) return apiError(c, "invalid_option", "followup is not one of the followup options");
      if (option.input) {
        if (body.value.value === undefined) return apiError(c, "invalid_option", "a value is required for this followup option");
        selectedFollowupValue = body.value.value;
      } else {
        if (body.value.value !== undefined) return apiError(c, "invalid_option", "value is not allowed for this followup option");
        selectedFollowupValue = option.value ?? undefined;
      }
    } else if (body.value.followup !== undefined || body.value.value !== undefined) {
      return apiError(c, "invalid_option", "followup is not available for this choice");
    }
    const assertion = assertionFrom(c);
    const commandBody: Record<string, string> = { choice: body.value.choice };
    if (body.value.note !== undefined) commandBody.note = body.value.note;
    if (body.value.followup !== undefined) commandBody.followup = body.value.followup;
    if (selectedFollowupValue !== undefined) commandBody.value = selectedFollowupValue;
    const command = db.createCommand({ workspaceId: ws, type: "answer", runId, decisionId, body: commandBody, by: assertion.sub,
      now: clock(), expiresAt: null });
    publish("command", ws, command.id);
    publish("decision", ws, `${runId}/${decisionId}`);
    publish("history", ws, command.id);
    return c.json(command, 201);
  });

  app.post(route(USER_ROUTES.reply.path), requireAuth, async (c) => {
    const ws = c.req.param("ws") ?? "";
    const row = requireWorkspace(db, c, ws);
    if (row instanceof Response) return row;
    const body = await readBody<TextRequest>(c, "TextRequest", LIMITS.textChars * 4);
    if ("response" in body) return body.response;
    const runId = c.req.param("run") ?? "";
    const decisionId = c.req.param("id") ?? "";
    const decision = db.getDecisionBody(ws, runId, decisionId);
    if (!decision) return apiError(c, "not_found", "decision not found");
    const state = hubDecision(db, ws, decision);
    if (!["OPEN", "SENT", "REJECTED"].includes(state.hub_status)) return apiError(c, "decision_not_answerable", "decision is not open, sent, or rejected");
    if (row.status !== "ONLINE") return apiError(c, "workspace_not_online", "workspace is not online");
    const assertion = assertionFrom(c);
    const command = db.createCommand({ workspaceId: ws, type: "reply", runId, decisionId, body: body.value, by: assertion.sub,
      now: clock(), expiresAt: null });
    publish("command", ws, command.id);
    publish("decision", ws, `${runId}/${decisionId}`);
    publish("history", ws, command.id);
    return c.json(command, 201);
  });

  app.post(route(USER_ROUTES.prompt.path), requireAuth, async (c) => {
    const ws = c.req.param("ws") ?? "";
    const row = requireWorkspace(db, c, ws);
    if (row instanceof Response) return row;
    const body = await readBody<TextRequest>(c, "TextRequest", LIMITS.textChars * 4);
    if ("response" in body) return body.response;
    if (row.status !== "ONLINE") return apiError(c, "workspace_not_online", "workspace is not online");
    const assertion = assertionFrom(c);
    const command = db.createCommand({ workspaceId: ws, type: "prompt", runId: null, decisionId: null, body: body.value,
      by: assertion.sub, now: clock(), expiresAt: clock() + LIMITS.promptExpirySeconds * 1000 });
    publish("command", ws, command.id);
    publish("history", ws, command.id);
    return c.json(command, 201);
  });

  app.get(route(USER_ROUTES.commands.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    const workspace = requireWorkspace(db, c, ws);
    if (workspace instanceof Response) return workspace;
    const items = db.listCommands(ws).map((command) => ({ ...command, _sort: [-Date.parse(command.created_at), command.id] }));
    return c.json(page(items, c.req.query("cursor")));
  });

  app.get(route(USER_ROUTES.documents.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    const workspace = requireWorkspace(db, c, ws);
    if (workspace instanceof Response) return workspace;
    const items = db.listDocuments(ws, c.req.query("run")).map((row) => ({
      path: String(row.path), run_id: row.run_id as string | null, kind: String(row.kind), title: String(row.title), format: String(row.format),
      bytes: Number(row.bytes), truncated: Boolean(row.truncated), updated_at: String(row.updated_at), deleted: Boolean(row.deleted),
      _sort: [-Date.parse(String(row.updated_at)), String(row.path)],
    }));
    return c.json(page(items, c.req.query("cursor")));
  });

  app.get(route(USER_ROUTES.document.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    const workspace = requireWorkspace(db, c, ws);
    if (workspace instanceof Response) return workspace;
    const path = c.req.query("path");
    if (!path) return apiError(c, "bad_request", "path is required");
    const document = db.getDocument(ws, path);
    if (!document) return apiError(c, "not_found", "document not found");
    const meta = { path: String(document.path), run_id: document.run_id as string | null, kind: String(document.kind), title: String(document.title),
      format: String(document.format), bytes: Number(document.bytes), truncated: Boolean(document.truncated), updated_at: String(document.updated_at), deleted: false };
    return c.json({ meta, content: String(document.content) });
  });

  app.get(route(USER_ROUTES.history.path), requireAuth, (c) => {
    const ws = c.req.param("ws") ?? "";
    if (requireWorkspace(db, c, ws) instanceof Response) return requireWorkspace(db, c, ws) as Response;
    const type = c.req.query("type");
    const run = c.req.query("run");
    let items = historyItems(db, ws);
    if (type) items = items.filter((item) => item.type === type);
    if (run) items = items.filter((item) => item.run_id === run);
    return c.json(page(items.map((item) => ({ ...item, _sort: [-Date.parse(item.at), item.id] })), c.req.query("cursor")));
  });
}
