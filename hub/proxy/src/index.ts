import { hasValidBearer } from "./auth.ts";
import { ComputerRelay } from "./computer-relay.ts";
import type { Env } from "./env.ts";
import { measurePasswordHash } from "./hash.ts";

const VERSION = "0.1.0";
const MAX_RELAY_BODY_BYTES = 900 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/health") {
    return json({ ok: true, version: VERSION });
  }

  if (path.startsWith("/spike/") && !hasValidBearer(request.headers.get("Authorization"), env["SPIKE_KEY"])) {
    return error("unauthorized", "A valid bearer token is required.", 401);
  }

  if (request.method === "POST" && path === "/spike/hash") {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return error("invalid_json", "Request body must be valid JSON.", 400);
    }

    const iterations = isRecord(input) ? input.iterations : undefined;
    if (!Number.isInteger(iterations) || Number(iterations) < 1_000 || Number(iterations) > 100_000) {
      return error("invalid_iterations", "iterations must be an integer from 1000 to 100000.", 400);
    }

    const wall_ms = await measurePasswordHash(Number(iterations));
    return json({ iterations: Number(iterations), wall_ms });
  }

  if (request.method === "POST" && path === "/spike/d1") {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return error("invalid_json", "Request body must be valid JSON.", 400);
    }

    if (!isRecord(input) || typeof input.note !== "string") {
      return error("invalid_note", "note must be a string.", 400);
    }

    const at = new Date().toISOString();
    const row = await env.DB.prepare("INSERT INTO spike_rows (note, at) VALUES (?, ?) RETURNING id, note, at")
      .bind(input.note, at)
      .first<{ id: number; note: string; at: string }>();
    const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM spike_rows").first<{ count: number }>();

    return json({ row, count: result?.count ?? 0 });
  }

  const computerRoute = /^\/spike\/computers\/([^/]+)\/(connect|relay)$/.exec(path);
  if (computerRoute) {
    let name: string;
    try {
      name = decodeURIComponent(computerRoute[1]);
    } catch {
      return error("invalid_computer_id", "Computer id is invalid.", 400);
    }

    if (computerRoute[2] === "relay") {
      if (request.method !== "POST") return error("method_not_allowed", "Use POST.", 405);
      const contentLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RELAY_BODY_BYTES) {
        return error("body_too_large", "Request bodies must be at most 900 KB.", 413);
      }

      const bytes = await request.clone().arrayBuffer();
      if (bytes.byteLength > MAX_RELAY_BODY_BYTES) {
        return error("body_too_large", "Request bodies must be at most 900 KB.", 413);
      }

      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return error("invalid_json", "Request body must be valid JSON.", 400);
      }
    } else if (request.method !== "GET") {
      return error("method_not_allowed", "Use GET.", 405);
    }

    const id = env.RELAY.idFromName(name);
    return env.RELAY.get(id).fetch(request);
  }

  if (path.startsWith("/spike/")) return error("not_found", "Route not found.", 404);
  return error("not_found", "Route not found.", 404);
}

export { ComputerRelay };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
};
