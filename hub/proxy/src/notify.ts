import { LIMITS } from "../../protocol/src/api.ts";
import type { NotificationStatus, NotifyItem, NotifyRequest, ZaloLinkCode } from "../../protocol/src/types.gen.ts";
import { constantTimeEqualText, randomBase32 } from "./crypto.ts";
import type { Env } from "./env.ts";
import { createZaloNotifier, type Notifier, type NotifierTarget, type ZaloSendResult } from "./zalo-sender.ts";

const LINK_CODE_TTL_MS = 10 * 60_000;
const NOTIFICATION_TEST_TEXT = "🔔 Agent Hub test: notifications work.";
const OFFLINE_TEXT = "has been offline for 10 minutes. Questions can't reach you until it is back.";
const RESERVE_MESSAGES = 50;
const MAX_WEBHOOK_BYTES = 64 * 1024;

type JsonRecord = Record<string, unknown>;
type TargetRow = {
  id: string;
  chat_id: string;
  chat_type: "private" | "group";
  display_name: string | null;
  linked_at: string;
  broken: number;
};
type SendDependencies = {
  notifier?: Notifier;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

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

export function zaloConfigured(env: Env): boolean {
  return Boolean(env.ZALO_BOT_TOKEN && env.ZALO_WEBHOOK_SECRET && env.ZALO_BOT_LINK);
}

function currentMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function monthlyLimit(env: Env): number {
  const configured = env.ZALO_MONTHLY_LIMIT;
  if (configured === undefined) return 3_000;
  if (!/^\d+$/.test(configured)) return 3_000;
  const parsed = Number(configured);
  return Number.isSafeInteger(parsed) ? parsed : 3_000;
}

function randomCode(): string {
  let code = "";
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
      if (byte >= 250) continue;
      code += String(byte % 10);
      if (code.length === 6) break;
    }
  }
  return code;
}

export async function createLinkCode(env: Env, userId: string, now: () => number = Date.now): Promise<ZaloLinkCode> {
  const timestamp = now();
  const expiresAt = timestamp + LINK_CODE_TTL_MS;
  await env.DB.prepare("DELETE FROM notify_link_codes WHERE expires_at <= ?").bind(timestamp).run();
  await env.DB.prepare("DELETE FROM notify_link_codes WHERE user_id = ?").bind(userId).run();

  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await env.DB.prepare("SELECT code FROM notify_link_codes WHERE code = ?").bind(code).first()) {
      code = randomCode();
      continue;
    }
    try {
      await env.DB.prepare("INSERT INTO notify_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(code, userId, expiresAt).run();
      return { code, expires_at: new Date(expiresAt).toISOString() };
    } catch {
      code = randomCode();
    }
  }
  throw new Error("A link code could not be created.");
}

function validNotifyItem(value: unknown): value is NotifyItem {
  if (!isRecord(value) || !hasOnlyKeys(value, ["workspace_id", "workspace_name", "kind", "run_id", "ref_id", "title"])) return false;
  return typeof value.workspace_id === "string" && /^ws_[a-z2-7]{16}$/.test(value.workspace_id)
    && typeof value.workspace_name === "string" && value.workspace_name.length >= 1 && value.workspace_name.length <= 200
    && ["question", "decision", "prompt_failed"].includes(String(value.kind))
    && (value.run_id === null || (typeof value.run_id === "string" && value.run_id.length <= 200))
    && typeof value.ref_id === "string" && value.ref_id.length >= 1 && value.ref_id.length <= 200
    && typeof value.title === "string" && value.title.length <= 500;
}

export function validNotifyRequest(value: unknown): value is NotifyRequest {
  return isRecord(value) && hasOnlyKeys(value, ["items"])
    && Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= 50
    && value.items.every(validNotifyItem);
}

function cleanLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function truncateCharacters(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function hubBaseUrl(env: Env): string | null {
  const configured = env.HUB_WEB_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : null;
}

function itemText(item: NotifyItem, env: Env): string {
  const workspace = cleanLine(item.workspace_name);
  const baseUrl = hubBaseUrl(env);
  const workspacePath = `/w/${encodeURIComponent(item.workspace_id)}`;
  const title = truncateCharacters(cleanLine(item.title), 120);
  if (item.kind === "question") {
    const questionId = item.ref_id.startsWith("D") ? item.ref_id.slice(1) : item.ref_id;
    const link = baseUrl ? `${baseUrl}/#${workspacePath}/d/inbox/${encodeURIComponent(item.ref_id)}` : "";
    return [`${workspace} · Q${questionId} question`, title, link].filter(Boolean).join("\n");
  }
  if (item.kind === "decision") {
    const decisionId = item.ref_id.startsWith("D") ? item.ref_id.slice(1) : item.ref_id;
    const runId = cleanLine(item.run_id ?? "");
    const link = baseUrl
      ? `${baseUrl}/#${workspacePath}/d/${encodeURIComponent(item.run_id ?? "")}/${encodeURIComponent(item.ref_id)}`
      : "";
    return [`${workspace} · ${runId} D${decisionId} decision`, title, link].filter(Boolean).join("\n");
  }
  const link = baseUrl ? `${baseUrl}/#${workspacePath}` : "";
  const lines = [
    `${workspace} · prompt not delivered`,
    "Your message was not delivered (Opus stayed busy 10 min). Open the hub to resend.",
    link,
  ];
  return lines.filter(Boolean).join("\n");
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

export function formatNotificationMessage(request: NotifyRequest, env: Env): string {
  const rendered = request.items.map((item) => itemText(item, env));
  for (let included = rendered.length; included >= 0; included -= 1) {
    const sections = ["🔔 Agent Hub", ...rendered.slice(0, included)];
    if (included < rendered.length) sections.push(`+${rendered.length - included} more in the hub`);
    const message = sections.join("\n\n");
    if (characterCount(message) <= 2_000) return message;
  }
  return "🔔 Agent Hub\n\nMore notifications are available in the hub.";
}

function configuredMonthlyCap(env: Env): number {
  return Math.max(0, monthlyLimit(env) - RESERVE_MESSAGES);
}

async function reserveUsage(env: Env, now: number): Promise<{ month: string; reserved: boolean }> {
  const month = currentMonth(now);
  await env.DB.prepare("INSERT INTO notify_usage (month, sent) VALUES (?, 0) ON CONFLICT(month) DO NOTHING")
    .bind(month).run();
  const result = await env.DB.prepare(
    "UPDATE notify_usage SET sent = sent + 1 WHERE month = ? AND sent < ? RETURNING sent",
  ).bind(month, configuredMonthlyCap(env)).first<{ sent: number }>();
  return { month, reserved: result !== null };
}

async function releaseUsage(env: Env, month: string): Promise<void> {
  await env.DB.prepare("UPDATE notify_usage SET sent = CASE WHEN sent > 0 THEN sent - 1 ELSE 0 END WHERE month = ?")
    .bind(month).run();
}

async function sendCounted(
  env: Env,
  target: NotifierTarget,
  text: string,
  notifier: Notifier,
  now: number,
): Promise<ZaloSendResult | null> {
  const reservation = await reserveUsage(env, now);
  if (!reservation.reserved) {
    console.warn(JSON.stringify({ event: "zalo_monthly_limit", month: reservation.month }));
    return null;
  }
  let result: ZaloSendResult;
  try {
    result = await notifier.send(target, text);
  } catch {
    result = { ok: false, kind: "network" };
  }
  if (!result.ok) await releaseUsage(env, reservation.month);
  return result;
}

async function setTargetBroken(env: Env, targetId: string, broken: boolean): Promise<void> {
  await env.DB.prepare("UPDATE notify_targets SET broken = ? WHERE id = ?").bind(broken ? 1 : 0, targetId).run();
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function deliverToTargets(
  env: Env,
  targets: TargetRow[],
  text: string,
  dependencies: SendDependencies = {},
): Promise<void> {
  const notifier = dependencies.notifier ?? createZaloNotifier(env);
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.sleep ?? sleep;
  for (const target of targets) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await sendCounted(env, { chat_id: target.chat_id }, text, notifier, now());
      if (result === null) break;
      if (result.ok) {
        await setTargetBroken(env, target.id, false);
        break;
      }
      if (result.kind === "rejected") {
        await setTargetBroken(env, target.id, true);
        break;
      }
      if (attempt < 2) await wait(attempt === 0 ? 1_000 : 3_000);
    }
  }
}

function configuredError(): Response {
  return error("zalo_not_configured", "Zalo notifications are not configured.", 503);
}

async function readJsonLimited(request: Request): Promise<unknown | null> {
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > LIMITS.relayFrameBytes) return null;
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function handleComputerNotify(
  request: Request,
  env: Env,
  computerId: string,
  dependencies: SendDependencies = {},
): Promise<Response> {
  if (!zaloConfigured(env)) return configuredError();
  const input = await readJsonLimited(request);
  if (!validNotifyRequest(input)) return error("bad_request", "Request body does not match NotifyRequest.", 400);
  const computer = await env.DB.prepare("SELECT user_id FROM computers WHERE id = ?")
    .bind(computerId).first<{ user_id: string }>();
  if (!computer) return error("not_found", "Computer not found.", 404);
  const result = await env.DB.prepare(
    "SELECT id, chat_id, chat_type, display_name, linked_at, broken FROM notify_targets WHERE user_id = ? AND broken = 0",
  ).bind(computer.user_id).all<TargetRow>();
  const targets = result.results ?? [];
  await deliverToTargets(env, targets, formatNotificationMessage(input, env), dependencies);
  return noContent();
}

async function getTargets(env: Env, userId: string): Promise<TargetRow[]> {
  const result = await env.DB.prepare(
    "SELECT id, chat_id, chat_type, display_name, linked_at, broken FROM notify_targets WHERE user_id = ? ORDER BY linked_at ASC",
  ).bind(userId).all<TargetRow>();
  return result.results ?? [];
}

export async function handleNotificationStatus(env: Env, userId: string, now: () => number = Date.now): Promise<Response> {
  const [rows, usage] = await Promise.all([
    getTargets(env, userId),
    env.DB.prepare("SELECT sent FROM notify_usage WHERE month = ?").bind(currentMonth(now())).first<{ sent: number }>(),
  ]);
  const status: NotificationStatus = {
    zalo_configured: zaloConfigured(env),
    bot_link: zaloConfigured(env) ? env.ZALO_BOT_LINK ?? null : null,
    targets: rows.map((row) => ({
      id: row.id,
      channel: "zalo",
      chat_type: row.chat_type,
      display_name: row.display_name,
      linked_at: row.linked_at,
      broken: row.broken !== 0,
    })),
    sent_this_month: usage?.sent ?? 0,
    monthly_limit: monthlyLimit(env),
  };
  return json(status);
}

export async function handleLinkCode(
  env: Env,
  userId: string,
  now: () => number = Date.now,
): Promise<Response> {
  if (!zaloConfigured(env)) return configuredError();
  return json(await createLinkCode(env, userId, now));
}

export async function handleUnlink(env: Env, userId: string, targetId: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM notify_targets WHERE id = ? AND user_id = ?").bind(targetId, userId).run();
  return noContent();
}

export async function handleTestNotification(
  env: Env,
  userId: string,
  dependencies: SendDependencies = {},
): Promise<Response> {
  if (!zaloConfigured(env)) return configuredError();
  const targets = await getTargets(env, userId);
  if (!targets.length) return error("no_targets", "Connect a Zalo chat before sending a test.", 409);
  await deliverToTargets(env, targets, NOTIFICATION_TEST_TEXT, dependencies);
  return noContent();
}

type IncomingMessage = {
  chatId: string;
  chatType: "private" | "group";
  displayName: string | null;
  text: string;
};

function parseIncomingMessage(update: unknown): IncomingMessage | null {
  if (!isRecord(update)) return null;
  let message: unknown = update.message;
  if (!isRecord(message) && isRecord(update.result)) message = update.result.message;
  if (!isRecord(message)) return null;
  const chat = message.chat;
  if (!isRecord(chat) || (typeof chat.id !== "string" && typeof chat.id !== "number")) return null;
  // The webhook body is undocumented: accept any case, and treat a missing chat_type as a private chat.
  const chatType = typeof chat.chat_type === "string" ? chat.chat_type.toUpperCase() : "PRIVATE";
  if (chatType !== "PRIVATE" && chatType !== "GROUP") return null;
  if (typeof message.text !== "string") return null;
  const from = isRecord(message.from) ? message.from : null;
  return {
    chatId: String(chat.id),
    chatType: chatType === "GROUP" ? "group" : "private",
    displayName: typeof from?.display_name === "string" ? from.display_name : null,
    text: message.text,
  };
}

function logUnknownUpdate(update: unknown, env: Env): void {
  const keys = isRecord(update) ? Object.keys(update).slice(0, 20) : [];
  const safeKeys = keys.map((key) => {
    if (/\d{6}/.test(key)) return key.replace(/\d{6}/g, "[redacted]");
    const secrets = [env.ZALO_BOT_TOKEN, env.ZALO_WEBHOOK_SECRET]
      .filter((secret): secret is string => Boolean(secret));
    return secrets.reduce((safe, secret) => safe.replaceAll(secret, "[redacted]"), key);
  });
  console.warn(JSON.stringify({ event: "zalo_webhook_unknown_shape", keys: safeKeys }));
}

async function sendWebhookReply(
  env: Env,
  chatId: string,
  text: string,
  dependencies: SendDependencies,
): Promise<void> {
  if (!env.ZALO_BOT_TOKEN) return;
  const notifier = dependencies.notifier ?? createZaloNotifier(env);
  await sendCounted(env, { chat_id: chatId }, text, notifier, (dependencies.now ?? Date.now)());
}

export async function handleZaloWebhook(
  request: Request,
  env: Env,
  dependencies: SendDependencies = {},
): Promise<Response> {
  const suppliedSecret = request.headers.get("X-Bot-Api-Secret-Token") ?? "";
  if (!env.ZALO_WEBHOOK_SECRET || !constantTimeEqualText(suppliedSecret, env.ZALO_WEBHOOK_SECRET)) {
    return error("unauthorized", "A valid Zalo webhook secret is required.", 401);
  }

  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_WEBHOOK_BYTES) return new Response(null, { status: 200 });
    let update: unknown;
    try { update = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response(null, { status: 200 }); }
    const incoming = parseIncomingMessage(update);
    if (!incoming) {
      logUnknownUpdate(update, env);
      return new Response(null, { status: 200 });
    }

    const text = incoming.text.trim();
    const code = /^\d{6}$/.test(text)
      ? await env.DB.prepare("SELECT code, user_id FROM notify_link_codes WHERE code = ? AND expires_at > ?")
        .bind(text, (dependencies.now ?? Date.now)()).first<{ code: string; user_id: string }>()
      : null;
    if (code) {
      const owner = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
        .bind(code.user_id).first<{ username: string }>();
      if (owner) {
        await env.DB.prepare(
          `INSERT INTO notify_targets (id, user_id, channel, chat_id, chat_type, display_name, linked_at, broken)
           VALUES (?, ?, 'zalo', ?, ?, ?, ?, 0)
           ON CONFLICT(user_id, chat_id) DO UPDATE SET chat_type = excluded.chat_type,
           display_name = excluded.display_name, linked_at = excluded.linked_at, broken = 0`,
        ).bind(`nt_${randomBase32(16)}`, code.user_id, incoming.chatId, incoming.chatType, incoming.displayName, new Date().toISOString()).run();
        await env.DB.prepare("DELETE FROM notify_link_codes WHERE code = ?").bind(code.code).run();
        await sendWebhookReply(
          env,
          incoming.chatId,
          `✅ Connected to Agent Hub (${owner.username}). Questions and decisions will arrive here.`,
          dependencies,
        );
        return new Response(null, { status: 200 });
      }
    }

    if (incoming.chatType === "private") {
      await sendWebhookReply(env, incoming.chatId, "Send the 6-digit code shown in Agent Hub → Notifications.", dependencies);
    }
  } catch {
    console.warn(JSON.stringify({ event: "zalo_webhook_processing_failed" }));
  }
  return new Response(null, { status: 200 });
}

async function readBoundedBody(response: Response): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function safeVerificationText(value: unknown, env: Env): string | null {
  if (typeof value !== "string") return null;
  if ([env.ZALO_BOT_TOKEN, env.ZALO_WEBHOOK_SECRET].filter(Boolean).some((secret) => value.includes(secret as string))) {
    return null;
  }
  return truncateCharacters(value, 500);
}

export async function handleZaloSetup(
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!env.ZALO_BOT_TOKEN || !env.ZALO_WEBHOOK_SECRET) return configuredError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  let responseText: string | null;
  try {
    response = await fetcher(`https://bot-api.zaloplatforms.com/bot${env.ZALO_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `${new URL(request.url).origin}/api/v1/zalo/webhook`,
        secret_token: env.ZALO_WEBHOOK_SECRET,
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    responseText = await readBoundedBody(response);
  } catch {
    return json({ ok: false, outcome: null, hint: "Zalo webhook setup failed." });
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try { if (responseText !== null) body = JSON.parse(responseText); } catch {}
  const root = isRecord(body) ? body : {};
  const nested = isRecord(root.result) ? root.result : root;
  const verification = nested.verification ?? root.verification;
  const details = isRecord(verification) ? verification : {};
  const outcome = safeVerificationText(
    typeof verification === "string" ? verification : details.outcome ?? details.status,
    env,
  );
  const hint = safeVerificationText(details.hint ?? details.description, env);
  return json({ ok: response.ok && root.ok === true, outcome, hint });
}

export async function notifyComputerOffline(
  env: Env,
  computerId: string,
  dependencies: SendDependencies = {},
): Promise<void> {
  if (!zaloConfigured(env)) return;
  const computer = await env.DB.prepare("SELECT user_id, name FROM computers WHERE id = ?")
    .bind(computerId).first<{ user_id: string; name: string }>();
  if (!computer) return;
  const result = await env.DB.prepare(
    "SELECT id, chat_id, chat_type, display_name, linked_at, broken FROM notify_targets WHERE user_id = ? AND broken = 0",
  ).bind(computer.user_id).all<TargetRow>();
  const targets = result.results ?? [];
  const text = `🔔 Agent Hub\n\n⚠️ ${cleanLine(computer.name)} ${OFFLINE_TEXT}`;
  await deliverToTargets(env, targets, text, dependencies);
}
