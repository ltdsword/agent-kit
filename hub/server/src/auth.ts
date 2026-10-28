import type { Context } from "hono";
import type { Device } from "@agent-hub/protocol";
import type { HubDatabase } from "./db.ts";

function bearer(c: Context): string | null {
  const value = c.req.header("Authorization");
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function requireConnector(db: HubDatabase) {
  return async (c: Context, next: () => Promise<void>) => {
    const token = bearer(c);
    if (!token) return c.json({ error: { code: "unauthorized", message: "a bearer token is required" } }, 401);
    if (db.isConnectorToken(token)) return next();
    if (db.isDeviceToken(token)) return c.json({ error: { code: "forbidden", message: "device token cannot use connector routes" } }, 403);
    return c.json({ error: { code: "unauthorized", message: "invalid or revoked token" } }, 401);
  };
}

export function requireDevice(db: HubDatabase, now: () => number) {
  return async (c: Context, next: () => Promise<void>) => {
    const token = bearer(c);
    if (!token) return c.json({ error: { code: "unauthorized", message: "a bearer token is required" } }, 401);
    const device = db.findDeviceByToken(token, now());
    if (device) {
      c.set("device", device);
      return next();
    }
    if (db.isConnectorToken(token)) return c.json({ error: { code: "forbidden", message: "connector key cannot use user routes" } }, 403);
    return c.json({ error: { code: "unauthorized", message: "invalid or revoked token" } }, 401);
  };
}

export function deviceFrom(c: Context): Device {
  return c.get("device") as Device;
}

export function tokenFromRequest(c: Context): string | null {
  return bearer(c);
}
