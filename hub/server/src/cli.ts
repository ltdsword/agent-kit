#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { DEFAULT_PORT } from "@agent-hub/protocol";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { HubDatabase } from "./db.ts";
import { createRelayClient, readRelayStatus } from "./relay.ts";
import { EventHub } from "./stream.ts";

async function openDatabase() {
  const config = await loadConfig(process.env, { allowExternalHost: process.argv.includes("--i-know") });
  const db = new HubDatabase(config.dbPath, config.connectorKeyHash);
  return { config, db };
}

async function serveHub(): Promise<void> {
  const { config, db } = await openDatabase();
  const events = new EventHub();
  const app = createApp({ db, config, events });
  const relay = createRelayClient(app, db, config, events, Date.now);
  db.sweepFinishedRuns(Date.now(), config.runRetentionDays ?? 60);
  if (relay) {
    relay.start();
    process.stdout.write("For a TLS-inspecting company proxy, enable system CAs with NODE_USE_SYSTEM_CA=1 or --use-system-ca.\n");
  } else process.stdout.write("Agent Hub relay off: computer.json is missing.\n");
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
  const retentionTimer = setInterval(() => db.sweepFinishedRuns(Date.now(), config.runRetentionDays ?? 60), 60 * 60_000);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    clearInterval(offlineTimer);
    clearInterval(retentionTimer);
    const finish = () => {
      server.close(() => db.close());
      // Open streams and keep-alive sockets would otherwise hold shutdown for many seconds.
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    };
    if (relay) void relay.stop().finally(finish);
    else finish();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function status(): Promise<void> {
  const config = await loadConfig(process.env, { readOnly: true });
  if (!config.computer) {
    process.stdout.write("Relay transport: off\nConnected: no\nOwner: not configured\n");
    return;
  }
  const relay = await readRelayStatus(config);
  const connected = relay?.connected === true && relay.owner === config.computer.username;
  process.stdout.write(`Relay transport: ${relay?.transport ?? "not connected"}\nConnected: ${connected ? "yes" : "no"}\nOwner: ${config.computer.username}\n`);
}

async function installService(): Promise<void> {
  const serviceDir = join(homedir(), ".config/systemd/user");
  await mkdir(serviceDir, { recursive: true, mode: 0o700 });
  const cliPath = fileURLToPath(import.meta.url);
  const body = `[Unit]\nDescription=Agent Hub backend\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${process.execPath} ${cliPath} serve\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;
  await writeFile(join(serviceDir, "agent-hub.service"), body, { mode: 0o600 });
  process.stdout.write("Run: systemctl --user enable --now agent-hub.service\n");
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === "serve") return serveHub();
  if (command === "status") return status();
  if (command === "install-service") return installService();
  process.stderr.write(`Usage: agent-hub serve | status | install-service (default port ${DEFAULT_PORT})\n`);
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
