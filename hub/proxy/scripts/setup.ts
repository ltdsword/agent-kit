import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type SetupOptions = { rotateAdminKey: boolean; origins: string[] };

export function parseSetupArgs(args: string[]): SetupOptions {
  const result: SetupOptions = { rotateAdminKey: false, origins: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--rotate-admin-key") {
      result.rotateAdminKey = true;
      continue;
    }
    if (arg === "--origins") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--origins requires a comma-separated list.");
      result.origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error(`Unknown setup argument: ${arg}`);
  }
  return result;
}

export function rewriteConfig(source: string, databaseId: string, origins: string[]): string {
  const config = JSON.parse(source) as {
    d1_databases?: Array<{ database_name?: string; database_id?: string }>;
    vars?: Record<string, string>;
  };
  const database = config.d1_databases?.find((entry) => entry.database_name === "agent-hub");
  if (!database) throw new Error("The Worker config has no agent-hub D1 binding.");
  database.database_id = databaseId;
  config.vars = { ...(config.vars ?? {}), ALLOWED_ORIGINS: origins.join(",") };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function configuredDatabaseId(source: string): string | undefined {
  const config = JSON.parse(source) as { d1_databases?: Array<{ database_name?: string; database_id?: string }> };
  return config.d1_databases?.find((entry) => entry.database_name === "agent-hub")?.database_id;
}

function runWrangler(args: string[], input?: string): string {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    input,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Wrangler command failed: ${args.slice(0, 2).join(" ")}.`);
  }
  return result.stdout ?? "";
}

function jsonFromOutput(output: string): unknown {
  const start = output.search(/[\[{]/);
  if (start < 0) throw new Error("Wrangler returned no JSON data.");
  return JSON.parse(output.slice(start));
}

function databaseIdFrom(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = databaseIdFrom(entry);
      if (id) return id;
    }
  }
  if (typeof value === "object" && value !== null) {
    const row = value as Record<string, unknown>;
    if (row.name === "agent-hub" && typeof row.uuid === "string") return row.uuid;
    if (row.name === "agent-hub" && typeof row.database_id === "string") return row.database_id;
    for (const child of Object.values(row)) {
      const id = databaseIdFrom(child);
      if (id) return id;
    }
  }
  return undefined;
}

function secretNamesFrom(output: string): Set<string> {
  try {
    const value = jsonFromOutput(output);
    const names = new Set<string>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
      } else if (typeof node === "object" && node !== null) {
        const row = node as Record<string, unknown>;
        if (typeof row.name === "string") names.add(row.name);
        for (const child of Object.values(row)) visit(child);
      }
    };
    visit(value);
    return names;
  } catch {
    return new Set([...output.matchAll(/\b(SIGNING_KEY|ADMIN_KEY_HASH)\b/g)].map((match) => match[1]));
  }
}

async function getDatabaseId(): Promise<string> {
  const listing = runWrangler(["d1", "list", "--json"]);
  const currentId = databaseIdFrom(jsonFromOutput(listing));
  if (currentId) return currentId;
  const created = runWrangler(["d1", "create", "agent-hub", "--json"]);
  const newId = databaseIdFrom(jsonFromOutput(created));
  if (!newId) throw new Error("Wrangler did not return a D1 database id.");
  return newId;
}

async function main(args: string[]): Promise<void> {
  const options = parseSetupArgs(args);
  const baseConfigPath = join(packageRoot, "wrangler.jsonc");
  const localConfigPath = join(packageRoot, "wrangler.local.jsonc");
  const source = await readFile(baseConfigPath, "utf8");
  let previousDatabaseId: string | undefined;
  try { previousDatabaseId = configuredDatabaseId(await readFile(localConfigPath, "utf8")); } catch {}
  const databaseId = await getDatabaseId();
  const accountChanged = Boolean(previousDatabaseId && previousDatabaseId !== databaseId);
  await writeFile(localConfigPath, rewriteConfig(source, databaseId, options.origins), "utf8");

  const configArg = ["--config", "wrangler.local.jsonc"];
  runWrangler(["d1", "migrations", "apply", "agent-hub", "--remote", ...configArg]);
  const secrets = secretNamesFrom(runWrangler(["secret", "list", ...configArg]));
  if (!secrets.has("SIGNING_KEY")) {
    const pair = generateKeyPairSync("ed25519");
    const signingKey = pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url");
    runWrangler(["secret", "put", "SIGNING_KEY", ...configArg], `${signingKey}\n`);
  }

  const configDirectory = join(homedir(), ".config", "agent-hub");
  const adminKeyPath = join(configDirectory, "admin.key");
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  let adminKey: string;
  try {
    adminKey = await readFile(adminKeyPath, "utf8");
    adminKey = adminKey.trim();
  } catch {
    adminKey = "";
  }
  const writeAdminKey = options.rotateAdminKey || accountChanged || !adminKey || !secrets.has("ADMIN_KEY_HASH");
  if (writeAdminKey) {
    adminKey = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(adminKey).digest("hex");
    runWrangler(["secret", "put", "ADMIN_KEY_HASH", ...configArg], `${hash}\n`);
    await writeFile(adminKeyPath, `${adminKey}\n`, { encoding: "utf8", mode: 0o600 });
  }
  await chmod(adminKeyPath, 0o600);

  const deployed = runWrangler(["deploy", ...configArg]);
  const proxyUrl = deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  if (!proxyUrl) throw new Error("Wrangler deploy did not report a workers.dev URL.");
  const adminInfoPath = join(configDirectory, "admin.json");
  await writeFile(adminInfoPath, `${JSON.stringify({ proxy_url: proxyUrl }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(adminInfoPath, 0o600);
  console.log(proxyUrl);
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => {
    console.error("Proxy setup failed. Check Wrangler login and local configuration.");
    process.exitCode = 1;
  });
}
