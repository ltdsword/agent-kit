import type { Context } from "hono";
import { ERRORS, validate, type DefName, type ErrorCode } from "@agent-hub/protocol";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function apiError(c: Context, code: ErrorCode, message: string): Response {
  return c.json({ error: { code, message } }, ERRORS[code] as ContentfulStatusCode);
}

export async function readBody<T>(c: Context, def: DefName, maxBytes: number): Promise<{ value: T } | { response: Response }> {
  const declaredLength = Number(c.req.header("Content-Length") || 0);
  if (declaredLength > maxBytes) return { response: apiError(c, "payload_too_large", "request body exceeds the allowed size") };
  const contentType = c.req.header("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return { response: apiError(c, "bad_request", "Content-Type must be application/json") };
  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  if (bytes.byteLength > maxBytes) return { response: apiError(c, "payload_too_large", "request body exceeds the allowed size") };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { response: apiError(c, "bad_request", "request body must be valid JSON") };
  }
  const result = validate(def, value);
  if (!result.ok) return { response: apiError(c, "bad_request", result.errors[0] ?? "request body is invalid") };
  return { value: value as T };
}

export function routePath(path: string): string {
  return path.split("?", 1)[0];
}
