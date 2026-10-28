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
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowExternalHost?: boolean } = {},
): Promise<ServerConfig> {
  const host = env.AGENT_HUB_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && !options.allowExternalHost) {
    throw new Error("AGENT_HUB_HOST must be 127.0.0.1; pass --i-know to bind elsewhere");
  }
  const port = Number(env.AGENT_HUB_PORT ?? 7420);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("AGENT_HUB_PORT must be a valid port");
  const dataDir = env.AGENT_HUB_DATA || join(homedir(), ".local/share/agent-hub");
  const configDir = env.AGENT_HUB_CONFIG || join(homedir(), ".config/agent-hub");
  await Promise.all([mkdir(dataDir, { recursive: true, mode: 0o700 }), mkdir(configDir, { recursive: true, mode: 0o700 })]);
  const connectorKeyPath = join(configDir, "connector.key");
  let key: string;
  try {
    key = (await readFile(connectorKeyPath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    key = randomBytes(32).toString("base64url");
    await writeFile(connectorKeyPath, `${key}\n`, { mode: 0o600, flag: "wx" });
  }
  await chmod(connectorKeyPath, 0o600);
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
  };
}
