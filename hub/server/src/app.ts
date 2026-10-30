import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { API_PREFIX, ERRORS, MIN_PROTOCOL, PROTOCOL_HEADER } from "@agent-hub/protocol";
import type { ServerConfig } from "./config.ts";
import { requireConnector } from "./auth.ts";
import type { HubDatabase } from "./db.ts";
import { apiError } from "./http.ts";
import { EventHub } from "./stream.ts";
import { mountConnectorApi } from "./connector-api.ts";
import { mountUserApi } from "./user-api.ts";
import type { AssertionVerifier } from "./auth.ts";
import type { NotificationOutbox } from "./notifier.ts";

export interface AppDependencies {
  db: HubDatabase;
  clock?: () => number;
  config: ServerConfig;
  events?: EventHub;
  assertionVerifier?: AssertionVerifier;
  notifier?: NotificationOutbox;
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();
  const clock = deps.clock ?? Date.now;
  const events = deps.events ?? new EventHub();
  const connectorAuth = requireConnector(deps.db);

  app.use("*", cors({
    origin: (origin) => {
      if (!origin) return undefined;
      const host = deps.config.host.includes(":") ? `[${deps.config.host}]` : deps.config.host;
      const ownOrigin = `http://${host}:${deps.config.port}`;
      return origin === ownOrigin || deps.config.origins.includes(origin) ? origin : undefined;
    },
    allowHeaders: ["Authorization", "Content-Type", "X-Agent-Hub-Protocol"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  }));

  app.use(`${API_PREFIX}/*`, async (c, next) => {
    const value = c.req.header(PROTOCOL_HEADER);
    const protocol = value === undefined ? 1 : Number(value);
    if (!Number.isInteger(protocol) || protocol < MIN_PROTOCOL) {
      return c.json({ error: { code: "protocol_unsupported", message: `protocol ${value ?? 1} is below minimum ${MIN_PROTOCOL}` } }, ERRORS.protocol_unsupported as 426);
    }
    await next();
  });
  app.use(`${API_PREFIX}/*`, async (_c, next) => {
    for (const command of deps.db.expireCommands(clock())) {
      const at = new Date(clock()).toISOString();
      events.publish({ type: "command", workspace_id: command.workspaceId, at, ref: command.id });
      events.publish({ type: "history", workspace_id: command.workspaceId, at, ref: command.id });
    }
    await next();
  });
  app.use(`${API_PREFIX}/agent/*`, connectorAuth);

  const apiDeps = { db: deps.db, clock, config: deps.config, events, assertionVerifier: deps.assertionVerifier, notifier: deps.notifier };
  mountConnectorApi(app, apiDeps);
  mountUserApi(app, apiDeps);

  app.onError((error, c) => {
    const code = (error as { code?: keyof typeof ERRORS }).code;
    if (code && code in ERRORS) return apiError(c, code, error.message);
    return c.json({ error: { code: "internal_error", message: "internal server error" } }, 500);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith(API_PREFIX)) return apiError(c, "not_found", "route not found");
    return c.html("<!doctype html><html><body><p>Agent Hub UI is not built yet.</p></body></html>");
  });

  app.get("*", async (c) => {
    if (c.req.path.startsWith(API_PREFIX)) return apiError(c, "not_found", "route not found");
    const dist = resolve(fileURLToPath(new URL("../../web/dist/", import.meta.url)));
    const requested = decodeURIComponent(c.req.path === "/" ? "/index.html" : c.req.path);
    const target = resolve(dist, `.${requested}`);
    if (target !== dist && !target.startsWith(`${dist}${sep}`)) return c.notFound();
    try {
      const bytes = await readFile(target);
      return c.body(bytes, 200, { "Content-Type": mimeTypes[extname(target)] ?? "application/octet-stream" });
    } catch {
      try {
        const html = await readFile(resolve(dist, "index.html"));
        return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
      } catch {
        return c.html("<!doctype html><html><body><p>Agent Hub UI is not built yet.</p></body></html>");
      }
    }
  });
  return app;
}
