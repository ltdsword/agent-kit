import type { Env } from "./env.ts";

const ZALO_API_ORIGIN = "https://bot-api.zaloplatforms.com";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 2_000;

export type ZaloSendResult =
  | { ok: true }
  | { ok: false; kind: "rejected" | "rate_limited" | "server" | "network" | "timeout" };

export type NotifierTarget = { chat_id: string };

export interface Notifier {
  send(target: NotifierTarget, text: string): Promise<ZaloSendResult>;
}

async function readResponseBody(response: Response): Promise<{ text: string } | { error: "oversized" | "network" }> {
  if (!response.body) return { text: "" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        return { error: "oversized" };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { error: "network" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

function timeoutError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (typeof error === "object" && error !== null
    && "name" in error && ((error as { name?: unknown }).name === "TimeoutError"));
}

/** Send one plain-text message without exposing Zalo credentials or response details. */
export async function sendZaloText(
  env: Env,
  chatId: string,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<ZaloSendResult> {
  if (!env.ZALO_BOT_TOKEN || !chatId || Array.from(text).length > MAX_TEXT_CHARS) {
    return { ok: false, kind: "rejected" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(`${ZALO_API_ORIGIN}/bot${env.ZALO_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (cause) {
      return { ok: false, kind: timeoutError(cause, controller.signal) ? "timeout" : "network" };
    }

    if (response.status === 429) return { ok: false, kind: "rate_limited" };
    if (response.status >= 500) return { ok: false, kind: "server" };
    if (response.status < 200 || response.status >= 300) return { ok: false, kind: "rejected" };

    const body = await readResponseBody(response);
    if (!("text" in body)) {
      return {
        ok: false,
        kind: body.error === "oversized" ? "rejected" : controller.signal.aborted ? "timeout" : "network",
      };
    }
    let result: unknown;
    try { result = JSON.parse(body.text); } catch { return { ok: false, kind: "rejected" }; }
    return typeof result === "object" && result !== null && !Array.isArray(result)
      && (result as Record<string, unknown>).ok === true
      ? { ok: true }
      : { ok: false, kind: "rejected" };
  } catch {
    return { ok: false, kind: timeoutError(undefined, controller.signal) ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function createZaloNotifier(env: Env, fetcher: typeof fetch = fetch): Notifier {
  return { send: (target, text) => sendZaloText(env, target.chat_id, text, fetcher) };
}
