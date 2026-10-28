#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { DEFAULT_PORT, LIMITS } from "@agent-hub/protocol";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { HubDatabase } from "./db.ts";
import { EventHub } from "./stream.ts";

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(8)].map((value) => alphabet[value % alphabet.length]).join("");
}

async function openDatabase() {
  const config = await loadConfig(process.env, { allowExternalHost: process.argv.includes("--i-know") });
  const db = new HubDatabase(config.dbPath, config.connectorKeyHash);
  return { config, db };
}

async function serveHub(): Promise<void> {
  const { config, db } = await openDatabase();
  const events = new EventHub();
  const app = createApp({ db, config, events });
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    process.stdout.write(`Agent Hub listening on http://${info.address}:${info.port}\n`);
  });
  const offlineTimer = setInterval(() => {
    for (const workspaceId of db.markOffline(Date.now())) {
      events.publish({ type: "workspace", workspace_id: workspaceId, at: new Date().toISOString(), ref: workspaceId });
    }
    for (const command of db.expireCommands(Date.now())) {
      const at = new Date().toISOString();
      events.publish({ type: "command", workspace_id: command.workspaceId, at, ref: command.id });
      events.publish({ type: "history", workspace_id: command.workspaceId, at, ref: command.id });
    }
  }, 10_000);
  const close = () => {
    clearInterval(offlineTimer);
    server.close();
    db.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function pair(name: string): Promise<void> {
  const { config, db } = await openDatabase();
  try {
    const pairingCode = code();
    db.createPairCode(pairingCode, name, Date.now(), Date.now() + LIMITS.pairCodeSeconds * 1000);
    process.stdout.write(`${pairingCode}\nhttp://127.0.0.1:${DEFAULT_PORT}/#pair=${pairingCode}\n`);
  } finally { db.close(); }
}

async function devices(args: string[]): Promise<void> {
  const { db } = await openDatabase();
  try {
    if (args[0] === "revoke" && args[1]) {
      if (!db.revokeDevice(args[1], Date.now())) throw new Error(`device not found: ${args[1]}`);
      process.stdout.write(`Revoked ${args[1]}\n`);
      return;
    }
    for (const device of db.listDevices()) process.stdout.write(`${device.id}\t${device.name}\t${device.created_at}\n`);
  } finally { db.close(); }
}

async function installService(): Promise<void> {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const serviceDir = join(configHome, "systemd/user");
  await mkdir(serviceDir, { recursive: true, mode: 0o700 });
  const cliPath = fileURLToPath(import.meta.url);
  const body = `[Unit]\nDescription=Agent Hub backend\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${process.execPath} ${cliPath} serve\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;
  await writeFile(join(serviceDir, "agent-hub.service"), body, { mode: 0o600 });
  process.stdout.write("Run: systemctl --user enable --now agent-hub.service\n");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "serve") return serveHub();
  if (command === "pair") {
    const nameIndex = args.indexOf("--name");
    const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
    if (!name) throw new Error("usage: agent-hub pair --name <device>");
    return pair(name);
  }
  if (command === "devices") return devices(args);
  if (command === "install-service") return installService();
  process.stderr.write("Usage: agent-hub serve | pair --name N | devices [revoke ID] | install-service\n");
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
