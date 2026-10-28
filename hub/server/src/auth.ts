import { createPublicKey, verify } from "node:crypto";
import type { Context } from "hono";
import { validate, type Assertion } from "@agent-hub/protocol";
import type { ComputerConfig } from "./config.ts";
import type { HubDatabase } from "./db.ts";

const relayFrameIds = new WeakMap<Request, string>();

export function bindRelayFrameId(request: Request, id: string): void {
  relayFrameIds.set(request, id);
}

export function requireConnector(db: HubDatabase) {
  return async (c: Context, next: () => Promise<void>) => {
    const value = c.req.header("Authorization");
    const match = value?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
    const token = match?.[1];
    if (!token) return c.json({ error: { code: "unauthorized", message: "a bearer token is required" } }, 401);
    return db.isConnectorToken(token)
      ? next()
      : c.json({ error: { code: "unauthorized", message: "invalid or revoked token" } }, 401);
  };
}

export function verifyAssertion(token: string, computer: ComputerConfig, now: number, relayFrameId: string | null): Assertion | null {
  if (!relayFrameId) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const payloadBytes = Buffer.from(parts[0], "base64url");
    const payload: unknown = JSON.parse(payloadBytes.toString("utf8"));
    if (!validate("Assertion", payload).ok) return null;
    const assertion = payload as Assertion;
    const publicKeyBytes = Buffer.from(computer.proxy_public_key, "base64url");
    if (publicKeyBytes.byteLength !== 32) return null;
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyBytes]),
      format: "der",
      type: "spki",
    });
    const signature = Buffer.from(parts[1], "base64url");
    const validSignature = verify(null, Buffer.from(parts[0], "ascii"), publicKey, signature);
    const nowSeconds = Math.floor(now / 1000);
    if (!validSignature || assertion.exp < nowSeconds || assertion.exp > nowSeconds + 120) return null;
    if (assertion.cid !== computer.computer_id || assertion.sub !== computer.username || assertion.rid !== relayFrameId) return null;
    return assertion;
  } catch {
    return null;
  }
}

export type AssertionVerifier = (token: string, relayFrameId: string | null, now: number) => Assertion | null | Promise<Assertion | null>;

export function requireAssertion(verifier: AssertionVerifier, clock: () => number = Date.now) {
  return async (c: Context, next: () => Promise<void>) => {
    const token = c.req.header("X-Hub-Assertion");
    if (!token) return c.json({ error: { code: "unauthorized", message: "a valid hub assertion is required" } }, 401);
    const assertion = await verifier(token, relayFrameIds.get(c.req.raw) ?? null, clock());
    if (!assertion) return c.json({ error: { code: "unauthorized", message: "a valid hub assertion is required" } }, 401);
    c.set("assertion", assertion);
    return next();
  };
}

export function assertionFrom(c: Context): Assertion {
  return c.get("assertion") as Assertion;
}
