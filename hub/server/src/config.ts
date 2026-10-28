import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  configDir: string;
  dbPath: string;
  connectorKeyPath: string;
  connectorKeyHash: string;
  origins: string[];
  kitVersion?: string;
  computerConfigPath?: string;
  computer?: ComputerConfig;
  recentDays?: number;
  runRetentionDays?: number;
}

export interface ComputerConfig {
  proxy_url: string;
  computer_id: string;
  computer_key: string;
  proxy_public_key: string;
  username: string;
}

export async function loadComputerConfig(path: string): Promise<ComputerConfig | undefined> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(contents);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("computer.json must contain an object");
  const config = value as Partial<ComputerConfig>;
  for (const key of ["proxy_url", "computer_id", "computer_key", "proxy_public_key", "username"] as const) {
    if (typeof config[key] !== "string" || config[key].length === 0) throw new Error(`computer.json is missing ${key}`);
  }
  const proxyUrl = new URL(config.proxy_url!);
  if (!['https:', 'http:'].includes(proxyUrl.protocol)) throw new Error("computer.json proxy_url must use HTTP or HTTPS");
  return config as ComputerConfig;
}

function envDays(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) throw new Error(`${name} must be a non-negative number`);
  return days;
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowExternalHost?: boolean; readOnly?: boolean } = {},
): Promise<ServerConfig> {
  const host = env.AGENT_HUB_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && !options.allowExternalHost) {
    throw new Error("AGENT_HUB_HOST must be 127.0.0.1; pass --i-know to bind elsewhere");
  }
  const port = Number(env.AGENT_HUB_PORT ?? 7420);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("AGENT_HUB_PORT must be a valid port");
  const dataDir = env.AGENT_HUB_DATA || join(homedir(), ".local/share/agent-hub");
  const configDir = env.AGENT_HUB_CONFIG || join(homedir(), ".config/agent-hub");
  if (!options.readOnly) await Promise.all([mkdir(dataDir, { recursive: true, mode: 0o700 }), mkdir(configDir, { recursive: true, mode: 0o700 })]);
  const connectorKeyPath = join(configDir, "connector.key");
  let key = "";
  try {
    key = (await readFile(connectorKeyPath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!options.readOnly) {
      key = randomBytes(32).toString("base64url");
      await writeFile(connectorKeyPath, `${key}\n`, { mode: 0o600, flag: "wx" });
    }
  }
  if (!options.readOnly && key) await chmod(connectorKeyPath, 0o600);
  const computerConfigPath = env.AGENT_HUB_COMPUTER || join(configDir, "computer.json");
  return {
    port,
    host,
    dataDir,
    configDir,
    dbPath: join(dataDir, "hub.db"),
    connectorKeyPath,
    connectorKeyHash: createHash("sha256").update(key).digest("hex"),
    origins: (env.AGENT_HUB_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
    kitVersion: env.AGENT_HUB_KIT_VERSION || undefined,
    computerConfigPath,
    computer: await loadComputerConfig(computerConfigPath),
    recentDays: envDays(env.AGENT_HUB_RECENT_DAYS, 15, "AGENT_HUB_RECENT_DAYS"),
    runRetentionDays: envDays(env.AGENT_HUB_RUN_RETENTION_DAYS, 60, "AGENT_HUB_RUN_RETENTION_DAYS"),
  };
}
