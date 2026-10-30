import { LIMITS } from "../../protocol/src/api.ts";
import { bearerToken } from "./auth.ts";
import { ComputerRelay } from "./computer-relay.ts";
import {
  handleComputerNotify,
  handleLinkCode,
  handleNotificationStatus,
  handleTestNotification,
  handleUnlink,
  handleZaloSetup,
  handleZaloWebhook,
} from "./notify.ts";
import {
  constantTimeEqualText,
  decodeBase64Url,
  derivePublicKey,
  encodeBase64Url,
  hashPassword,
  randomBase32,
  randomPassword,
  randomToken,
  sha256Hex,
  signAssertion,
  verifyPassword,
} from "./crypto.ts";
import type { Env } from "./env.ts";

const VERSION = "2.0.0";
const USERNAME_PATTERN = /^[a-z][a-z0-9_-]{2,31}$/;
const DUMMY_SALT = encodeBase64Url(new Uint8Array(16));
const DUMMY_HASH = encodeBase64Url(new Uint8Array(32));

type JsonRecord = Record<string, unknown>;
type UserRow = {
  id: string;
  username: string;
  pw_hash: string;
  pw_salt: string;
  pw_iter: number;
};
type Session = UserRow & { token_hash: string };
type ComputerRow = { id: string; name: string; last_seen_at: string | null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

async function readJson(request: Request): Promise<unknown | Response> {
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > LIMITS.relayFrameBytes) {
      return error("payload_too_large", "Request bodies must be at most 900 KB.", 413);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return error("bad_request", "Request body must be valid JSON.", 400);
  }
}

function isUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_PATTERN.test(value);
}

function isPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

function validateLoginBody(value: unknown): value is { username: string; password: string; remember: boolean } {
  return isRecord(value) && hasOnlyKeys(value, ["username", "password", "remember"])
    && isUsername(value.username) && isPassword(value.password) && typeof value.remember === "boolean";
}

async function checkLoginRateLimit(request: Request, env: Env, username: string): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = await sha256Hex(`${username}\u0000${ip}`);
  const windowStart = Math.floor(Date.now() / 60_000);
  const result = await env.DB.prepare(
    `INSERT INTO login_attempts (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN login_attempts.window_start = excluded.window_start THEN login_attempts.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
  ).bind(key, windowStart).first<{ count: number }>();
  await env.DB.prepare("DELETE FROM login_attempts WHERE window_start < ?").bind(windowStart - 1).run();
  return (result?.count ?? 1) > LIMITS.loginAttemptsPerMinute;
}

async function authenticateSession(request: Request, env: Env): Promise<Session | Response> {
  const token = bearerToken(request.headers.get("Authorization"));
  if (!token) return error("unauthorized", "A valid session token is required.", 401);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const session = await env.DB.prepare(
    `SELECT u.id, u.username, u.pw_hash, u.pw_salt, u.pw_iter, s.token_hash
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(tokenHash, now).first<Session>();
  if (!session) return error("unauthorized", "A valid session token is required.", 401);
  await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  return session;
}

async function adminAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = bearerToken(request.headers.get("Authorization"));
  if (!token || !env.ADMIN_KEY_HASH) return false;
  return constantTimeEqualText(await sha256Hex(token), env.ADMIN_KEY_HASH);
}

async function computerAuthorized(request: Request, env: Env, computerId: string): Promise<boolean> {
  const token = bearerToken(request.headers.get("Authorization"));
  if (!token) return false;
  const computer = await env.DB.prepare("SELECT key_hash FROM computers WHERE id = ?")
    .bind(computerId).first<{ key_hash: string }>();
  if (!computer) return false;
  return constantTimeEqualText(await sha256Hex(token), computer.key_hash);
}

async function computerOnline(env: Env, computerId: string): Promise<boolean> {
  try {
    const id = env.RELAY.idFromName(computerId);
    const response = await env.RELAY.get(id).fetch(`https://relay/internal/computers/${encodeURIComponent(computerId)}/status`);
    if (!response.ok) return false;
    const status = await response.json() as { online?: unknown };
    return status.online === true;
  } catch {
    return false;
  }
}

async function relayToComputer(
  env: Env,
  user: Session,
  computerId: string,
  method: string,
  path: string,
  query: string,
  body: unknown,
  stream = false,
  signal?: AbortSignal,
): Promise<Response> {
  if (!env.SIGNING_KEY) return error("internal_error", "Proxy signing is not configured.", 500);
  const id = randomToken();
  let assertion: string;
  try {
    ({ assertion } = await signAssertion(env.SIGNING_KEY, user.username, computerId, id));
  } catch {
    return error("internal_error", "Proxy signing is not configured.", 500);
  }
  const frame = { type: "req", id, method, path, query, body, assertion, stream };
  const durableObject = env.RELAY.get(env.RELAY.idFromName(computerId));
  const request = new Request(`https://relay/internal/computers/${encodeURIComponent(computerId)}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(frame),
    ...(signal ? { signal } : {}),
  });
  const response = await durableObject.fetch(request);
  if (!stream || response.status >= 400 || !response.body) return response;
  const reader = response.body.getReader();
  let cancelSent = false;
  const sendCancel = async (): Promise<void> => {
    if (cancelSent) return;
    cancelSent = true;
    try {
      await durableObject.fetch(new Request(`https://relay/internal/computers/${encodeURIComponent(computerId)}/cancel/${encodeURIComponent(id)}`, {
        method: "POST",
      }));
    } catch {}
  };
  signal?.addEventListener("abort", () => { void sendCancel(); }, { once: true });
  const streamBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) controller.close();
      else controller.enqueue(result.value);
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch {}
      await sendCancel();
    },
  });
  return new Response(streamBody, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function listComputers(env: Env, userId: string): Promise<ComputerRow[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, last_seen_at FROM computers WHERE user_id = ? ORDER BY created_at ASC",
  ).bind(userId).all<ComputerRow>();
  return result.results ?? [];
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request);
  if (input instanceof Response) return input;
  if (!validateLoginBody(input)) return error("bad_request", "Request body does not match LoginRequest.", 400);
  if (await checkLoginRateLimit(request, env, input.username)) {
    return error("rate_limited", "Too many login attempts. Try again in a minute.", 429);
  }

  const user = await env.DB.prepare("SELECT id, username, pw_hash, pw_salt, pw_iter FROM users WHERE username = ?")
    .bind(input.username).first<UserRow>();
  const passwordIsValid = user
    ? await verifyPassword(input.password, user.pw_salt, user.pw_hash, user.pw_iter)
    : await verifyPassword(input.password, DUMMY_SALT, DUMMY_HASH, LIMITS.pbkdf2Iterations);
  if (!user || !passwordIsValid) return error("invalid_credentials", "Invalid username or password.", 401);

  if (user.pw_iter < LIMITS.pbkdf2Iterations) {
    const upgraded = await hashPassword(input.password);
    await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?")
      .bind(upgraded.hash, upgraded.salt, upgraded.iterations, new Date().toISOString(), user.id).run();
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = new Date(now + (input.remember ? LIMITS.sessionRememberDays * 86_400_000 : LIMITS.sessionHours * 3_600_000)).toISOString();
  const timestamp = new Date(now).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(tokenHash, user.id, timestamp, expiresAt, timestamp, request.headers.get("User-Agent")).run();
  return json({ token, expires_at: expiresAt, username: user.username });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const session = await authenticateSession(request, env);
  if (session instanceof Response) return session;
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.token_hash).run();
  return noContent();
}

async function handlePasswordChange(request: Request, env: Env): Promise<Response> {
  const session = await authenticateSession(request, env);
  if (session instanceof Response) return session;
  const input = await readJson(request);
  if (input instanceof Response) return input;
  if (!isRecord(input) || !hasOnlyKeys(input, ["current", "new"])
    || !isPassword(input.current) || typeof input.new !== "string") {
    return error("bad_request", "Request body does not match PasswordChangeRequest.", 400);
  }
  if (input.new.length < LIMITS.passwordMinChars || input.new.length > 256) {
    return error("weak_password", "New password must be between 12 and 256 characters.", 422);
  }
  if (!await verifyPassword(input.current, session.pw_salt, session.pw_hash, session.pw_iter)) {
    return error("invalid_credentials", "Current password is incorrect.", 401);
  }

  const password = await hashPassword(input.new);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?")
    .bind(password.hash, password.salt, password.iterations, now, session.id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
    .bind(session.id, session.token_hash).run();
  return noContent();
}

async function handleMe(session: Session, env: Env): Promise<Response> {
  const computers = await Promise.all((await listComputers(env, session.id)).map(async (computer) => ({
    id: computer.id,
    name: computer.name,
    online: await computerOnline(env, computer.id),
    last_seen_at: computer.last_seen_at,
  })));
  return json({ username: session.username, computers });
}

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  return await adminAuthorized(request, env)
    ? null
    : error("unauthorized", "A valid admin key is required.", 401);
}

async function handleCreateUser(request: Request, env: Env): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const input = await readJson(request);
  if (input instanceof Response) return input;
  if (!isRecord(input) || !hasOnlyKeys(input, ["username"]) || !isUsername(input.username)) {
    return error("bad_request", "Request body does not match AdminUserRequest.", 400);
  }
  if (await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(input.username).first()) {
    return error("username_taken", "That username is already taken.", 409);
  }

  const password = randomPassword();
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, username, pw_hash, pw_salt, pw_iter, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(`u_${randomToken().slice(0, 24)}`, input.username, hash.hash, hash.salt, hash.iterations, now, now).run();
  } catch {
    if (await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(input.username).first()) {
      return error("username_taken", "That username is already taken.", 409);
    }
    return error("internal_error", "User could not be created.", 500);
  }
  return json({ username: input.username, password }, 201);
}

async function handleResetPassword(request: Request, env: Env, username: string): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!isUsername(username)) return error("not_found", "User not found.", 404);
  const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: string }>();
  if (!user) return error("not_found", "User not found.", 404);
  const password = randomPassword();
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?")
    .bind(hash.hash, hash.salt, hash.iterations, now, user.id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  return json({ username, password });
}

async function handleComputerRegister(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request);
  if (input instanceof Response) return input;
  if (!isRecord(input) || !hasOnlyKeys(input, ["username", "password", "name"])
    || !isUsername(input.username) || !isPassword(input.password)
    || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 64) {
    return error("bad_request", "Request body does not match ComputerRegisterRequest.", 400);
  }
  if (await checkLoginRateLimit(request, env, input.username)) {
    return error("rate_limited", "Too many login attempts. Try again in a minute.", 429);
  }
  const user = await env.DB.prepare("SELECT id, username, pw_hash, pw_salt, pw_iter FROM users WHERE username = ?")
    .bind(input.username).first<UserRow>();
  const passwordIsValid = user
    ? await verifyPassword(input.password, user.pw_salt, user.pw_hash, user.pw_iter)
    : await verifyPassword(input.password, DUMMY_SALT, DUMMY_HASH, LIMITS.pbkdf2Iterations);
  if (!user || !passwordIsValid) return error("invalid_credentials", "Invalid username or password.", 401);

  if (user.pw_iter < LIMITS.pbkdf2Iterations) {
    const upgraded = await hashPassword(input.password);
    await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?")
      .bind(upgraded.hash, upgraded.salt, upgraded.iterations, new Date().toISOString(), user.id).run();
  }

  let publicKey: string;
  try {
    if (!env.SIGNING_KEY) throw new Error("missing key");
    publicKey = encodeBase64Url(await derivePublicKey(decodeBase64Url(env.SIGNING_KEY)));
  } catch {
    return error("internal_error", "Proxy signing is not configured.", 500);
  }
  const computerId = `c_${randomBase32(16)}`;
  const computerKey = randomToken();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO computers (id, user_id, name, key_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL)",
  ).bind(computerId, user.id, input.name, await sha256Hex(computerKey), now).run();
  return json({ computer_id: computerId, computer_key: computerKey, proxy_public_key: publicKey, username: user.username }, 201);
}

function apiVersionError(request: Request): Response | null {
  const version = request.headers.get("X-Agent-Hub-Protocol");
  if (version !== null && Number(version) >= 2) return null;
  return error("protocol_unsupported", "Protocol 2 is required.", 426);
}

async function handleComputerRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const match = /^\/api\/v1\/computers\/([^/]+)\/(connect|poll|frames|notify)$/.exec(url.pathname);
  if (!match) return null;
  let computerId: string;
  try { computerId = decodeURIComponent(match[1]); } catch { return error("not_found", "Computer not found.", 404); }
  if (!/^c_[a-z2-7]{16}$/.test(computerId)) return error("not_found", "Computer not found.", 404);
  if (!await computerAuthorized(request, env, computerId)) return error("unauthorized", "A valid computer key is required.", 401);
  if (match[2] === "notify") {
    if (request.method !== "POST") return error("bad_request", "Use POST.", 405);
    return handleComputerNotify(request, env, computerId);
  }
  return env.RELAY.get(env.RELAY.idFromName(computerId)).fetch(request);
}

async function handleComputerStream(request: Request, env: Env, session: Session, url: URL): Promise<Response | null> {
  const match = /^\/api\/v1\/computers\/([^/]+)\/stream$/.exec(url.pathname);
  if (!match) return null;
  let computerId: string;
  try { computerId = decodeURIComponent(match[1]); } catch { return error("not_found", "Computer not found.", 404); }
  const computer = await env.DB.prepare("SELECT id FROM computers WHERE id = ? AND user_id = ?")
    .bind(computerId, session.id).first<{ id: string }>();
  if (!computer) return error("not_found", "Computer not found.", 404);
  const response = await relayToComputer(env, session, computerId, "GET", "/api/v1/stream", "", null, true, request.signal);
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache");
  return new Response(response.body, { status: response.status, headers });
}

type LiveComputer = { id: string; online: boolean; listed: boolean };

async function handleWorkspaces(request: Request, env: Env, session: Session, url: URL): Promise<Response> {
  const computers = await listComputers(env, session.id);
  const liveResults = await Promise.all(computers.map(async (computer): Promise<{ status: LiveComputer; items: JsonRecord[] }> => {
    const online = await computerOnline(env, computer.id);
    if (!online) return { status: { id: computer.id, online: false, listed: false }, items: [] };
    try {
      const timeout = AbortSignal.timeout(10_000);
      const live = await relayToComputer(env, session, computer.id, "GET", "/api/v1/workspaces", url.search.slice(1), null, false, timeout);
      if (!live.ok) return { status: { id: computer.id, online: true, listed: false }, items: [] };
      const result: unknown = await live.json();
      if (!isRecord(result) || !Array.isArray(result.items)) {
        return { status: { id: computer.id, online: true, listed: false }, items: [] };
      }
      const items = result.items.filter(isRecord).map((workspace) => ({
        ...workspace,
        computer_id: computer.id,
        computer_online: true,
      }));
      return { status: { id: computer.id, online: true, listed: true }, items };
    } catch {
      return { status: { id: computer.id, online: true, listed: false }, items: [] };
    }
  }));

  const items = liveResults.flatMap((result) => result.items);
  const recentCutoff = new Date(Date.now() - LIMITS.recentWorkspaceDays * 86_400_000).toISOString();
  // A computer that is offline, or online but failed to answer in time, falls back to its last known index
  // so a slow relay never makes the workspace list look empty.
  const unlisted = new Map(liveResults.filter((result) => !result.status.listed).map((result) => [result.status.id, result.status.online]));
  if (unlisted.size) {
    const indexes = await env.DB.prepare(
      `SELECT wi.workspace_id, wi.name, wi.status, wi.last_seen_at, c.id AS computer_id
       FROM workspace_index wi JOIN computers c ON c.id = wi.computer_id
       WHERE c.user_id = ? AND wi.last_seen_at >= ? ORDER BY wi.last_seen_at DESC`,
    ).bind(session.id, recentCutoff).all<{ workspace_id: string; name: string; status: string; last_seen_at: string | null; computer_id: string }>();
    const seen = new Set(items.map((item) => item.id));
    for (const index of indexes.results ?? []) {
      if (!unlisted.has(index.computer_id) || seen.has(index.workspace_id)) continue;
      items.push({
        id: index.workspace_id,
        name: index.name,
        path: null,
        // A reachable computer keeps the status it last reported; an unreachable one is offline.
        status: unlisted.get(index.computer_id) === true ? index.status : "OFFLINE",
        last_seen_at: index.last_seen_at,
        kit_version: null,
        kit_outdated: false,
        open_decisions: 0,
        problems: 0,
        orchestrator_state: null,
        active_run: null,
        archived: false,
        upload: null,
        orchestrator_last_activity_at: null,
        computer_id: index.computer_id,
        computer_online: unlisted.get(index.computer_id) === true,
      });
    }
  }

  items.sort((left, right) => {
    const online = Number(right.computer_online === true) - Number(left.computer_online === true);
    if (online !== 0) return online;
    return String(right.last_seen_at ?? "").localeCompare(String(left.last_seen_at ?? ""));
  });
  return json({ items, next: null });
}

async function handleWorkspaceRoute(request: Request, env: Env, session: Session, url: URL): Promise<Response | null> {
  const match = /^\/api\/v1\/workspaces\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  let workspaceId: string;
  try { workspaceId = decodeURIComponent(match[1]); } catch { return error("not_found", "Workspace not found.", 404); }
  if (!/^ws_[a-z2-7]{16}$/.test(workspaceId)) return error("not_found", "Workspace not found.", 404);
  const index = await env.DB.prepare(
    `SELECT wi.computer_id FROM workspace_index wi JOIN computers c ON c.id = wi.computer_id
     WHERE wi.workspace_id = ? AND c.user_id = ?`,
  ).bind(workspaceId, session.id).first<{ computer_id: string }>();
  if (!index) return error("not_found", "Workspace not found.", 404);

  let body: unknown = null;
  if (!["GET", "HEAD"].includes(request.method) && request.body) {
    const parsed = await readJson(request);
    if (parsed instanceof Response) return parsed;
    body = parsed;
  }
  const stream = request.method === "GET" && url.pathname.endsWith("/documents/content");
  const response = await relayToComputer(
    env,
    session,
    index.computer_id,
    request.method,
    url.pathname,
    url.search.slice(1),
    body,
    stream,
    request.signal,
  );
  if (!stream || response.status === 204 || response.status >= 400) return response;
  try {
    const joined = await response.text();
    return json(JSON.parse(joined), response.status);
  } catch {
    return error("internal_error", "Computer returned an invalid streamed JSON response.", 502);
  }
}

async function handleUserRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const { pathname } = url;
  if (request.method === "POST" && pathname === "/api/v1/auth/login") return handleLogin(request, env);
  if (request.method === "POST" && pathname === "/api/v1/zalo/webhook") return handleZaloWebhook(request, env);

  if (request.method === "POST" && pathname === "/api/v1/admin/users") return handleCreateUser(request, env);
  if (request.method === "POST" && pathname === "/api/v1/admin/zalo/setup") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return handleZaloSetup(request, env);
  }
  const reset = /^\/api\/v1\/admin\/users\/([^/]+)\/reset-password$/.exec(pathname);
  if (request.method === "POST" && reset) {
    let username: string;
    try { username = decodeURIComponent(reset[1]); } catch { return error("not_found", "User not found.", 404); }
    return handleResetPassword(request, env, username);
  }

  if (request.method === "POST" && pathname === "/api/v1/computers/register") return handleComputerRegister(request, env);
  const computerRoute = await handleComputerRoute(request, env, url);
  if (computerRoute) return computerRoute;

  const requiresSession = pathname === "/api/v1/auth/logout"
    || pathname === "/api/v1/auth/password"
    || pathname === "/api/v1/me"
    || pathname === "/api/v1/notifications"
    || pathname === "/api/v1/notifications/zalo/code"
    || pathname === "/api/v1/notifications/test"
    || /^\/api\/v1\/notifications\/targets\/[^/]+$/.test(pathname)
    || pathname === "/api/v1/workspaces"
    || pathname.startsWith("/api/v1/workspaces/")
    || /^\/api\/v1\/computers\/[^/]+\/stream$/.test(pathname);
  if (!requiresSession) return null;

  const protocolError = apiVersionError(request);
  if (protocolError) return protocolError;
  const session = await authenticateSession(request, env);
  if (session instanceof Response) return session;

  if (request.method === "POST" && pathname === "/api/v1/auth/logout") return handleLogout(request, env);
  if (request.method === "POST" && pathname === "/api/v1/auth/password") return handlePasswordChange(request, env);
  if (request.method === "GET" && pathname === "/api/v1/me") return handleMe(session, env);
  if (request.method === "GET" && pathname === "/api/v1/notifications") return handleNotificationStatus(env, session.id);
  if (request.method === "POST" && pathname === "/api/v1/notifications/zalo/code") {
    return handleLinkCode(env, session.id);
  }
  if (request.method === "POST" && pathname === "/api/v1/notifications/test") {
    return handleTestNotification(env, session.id);
  }
  const target = /^\/api\/v1\/notifications\/targets\/([^/]+)$/.exec(pathname);
  if (request.method === "DELETE" && target) {
    let targetId: string;
    try { targetId = decodeURIComponent(target[1]); } catch { return error("not_found", "Notification target not found.", 404); }
    return handleUnlink(env, session.id, targetId);
  }
  if (request.method === "GET" && pathname === "/api/v1/workspaces") return handleWorkspaces(request, env, session, url);

  const streamResponse = await handleComputerStream(request, env, session, url);
  if (streamResponse) return streamResponse;
  return handleWorkspaceRoute(request, env, session, url);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, version: VERSION });
  const response = await handleUserRoutes(request, env, url);
  return response ?? error("not_found", "Route not found.", 404);
}

function allowedOrigins(env: Env): Set<string> {
  return new Set([
    "http://localhost:5173",
    ...(env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
  ]);
}

function withCors(response: Response, request: Request, env: Env): Response {
  if (response.status === 101) return response;
  const origin = request.headers.get("Origin");
  const allowOrigin = origin && allowedOrigins(env).has(origin) ? origin : null;
  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  if (allowOrigin) {
    headers.set("Access-Control-Allow-Origin", allowOrigin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Agent-Hub-Protocol");
    headers.set("Access-Control-Max-Age", "600");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { ComputerRelay };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const isWebhook = new URL(request.url).pathname === "/api/v1/zalo/webhook";
    if (request.method === "OPTIONS") return isWebhook ? noContent() : withCors(noContent(), request, env);
    try {
      const response = await route(request, env);
      return isWebhook ? response : withCors(response, request, env);
    } catch {
      const response = error("internal_error", "Internal server error.", 500);
      return isWebhook ? response : withCors(response, request, env);
    }
  },
};
