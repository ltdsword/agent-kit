import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type {
  AckRequest,
  Command,
  Decision,
  Document,
  EventsBatch,
  HelloRequest,
  Run,
  Snapshot,
  UserCommand,
  WorkspaceIndexEntry,
} from "@agent-hub/protocol";

export type Row = Record<string, string | number | null>;
const iso = (time: number) => new Date(time).toISOString();
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const id16 = () => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  return [...randomBytes(16)].map((value) => alphabet[value % alphabet.length]).join("");
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class HubDatabase {
  readonly sql: DatabaseSync;

  constructor(path: string, connectorKeyHash: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    for (const name of readdirSync(migrationDir).filter((entry) => entry.endsWith(".sql")).sort()) {
      const applied = this.sql.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(name);
      if (applied) continue;
      this.sql.exec("BEGIN");
      try {
        this.sql.exec(readFileSync(join(migrationDir, name), "utf8"));
        this.sql.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, iso(Date.now()));
        this.sql.exec("COMMIT");
      } catch (error) {
        this.sql.exec("ROLLBACK");
        throw error;
      }
    }
    this.sql.prepare("INSERT INTO connector_keys (id, token_hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash").run(connectorKeyHash);
  }

  close(): void { this.sql.close(); }

  audit(workspaceId: string | null, actor: string, action: string, target: string | null, detail: unknown, now: number): void {
    this.sql.prepare("INSERT INTO audit_log (workspace_id,actor,action,target,detail,at) VALUES (?,?,?,?,?,?)")
      .run(workspaceId, actor, action, target, detail === null ? null : JSON.stringify(detail), iso(now));
  }

  isConnectorToken(token: string): boolean {
    return this.sql.prepare("SELECT 1 FROM connector_keys WHERE token_hash = ?").get(hash(token)) !== undefined;
  }

  hello(request: HelloRequest, now: number): { known: boolean; event_cursors: Record<string, number>; decision_hashes: Record<string, string>; document_hashes: Record<string, string>; snapshot_hash: string | null } {
    const previous = this.getWorkspace(request.workspace_id);
    const lastSeen = previous?.last_seen_at ? Date.parse(String(previous.last_seen_at)) : 0;
    const active = this.sql.prepare("SELECT id FROM workspace_sessions WHERE workspace_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
      .get(request.workspace_id) as Row | undefined;
    if (active && active.id !== request.session_id && now - lastSeen <= 90_000) {
      throw Object.assign(new Error("another live session already holds this workspace"), { code: "duplicate_workspace" });
    }
    const timestamp = iso(now);
    this.sql.prepare(`INSERT INTO workspaces (id,name,path,kit_version,status,first_seen_at,last_seen_at,archived_at,upload)
      VALUES (?,?,?,?, 'ONLINE',?,?,NULL,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,kit_version=excluded.kit_version,status='ONLINE',last_seen_at=excluded.last_seen_at,archived_at=NULL,upload=excluded.upload`)
      .run(request.workspace_id, request.name, request.path, request.kit_version, timestamp, timestamp, JSON.stringify(request.upload));
    this.sql.prepare("UPDATE workspace_sessions SET ended_at = ?, end_reason = 'replaced' WHERE workspace_id = ? AND ended_at IS NULL AND id <> ?")
      .run(timestamp, request.workspace_id, request.session_id);
    this.sql.prepare(`INSERT INTO workspace_sessions (id,workspace_id,started_at) VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET ended_at=NULL,end_reason=NULL`).run(request.session_id, request.workspace_id, timestamp);
    this.audit(request.workspace_id, "connector", "workspace.hello", request.session_id, { name: request.name, path: request.path }, now);
    const eventCursors: Record<string, number> = {};
    for (const row of this.sql.prepare("SELECT run_id, MAX(n) AS n FROM events WHERE workspace_id = ? GROUP BY run_id").all(request.workspace_id) as Row[]) eventCursors[String(row.run_id)] = Number(row.n);
    const decisionHashes: Record<string, string> = {};
    for (const row of this.sql.prepare("SELECT run_id,decision_id,content_hash FROM decisions WHERE workspace_id = ?").all(request.workspace_id) as Row[]) decisionHashes[`${row.run_id}/${row.decision_id}`] = String(row.content_hash);
    const documentHashes: Record<string, string> = {};
    for (const row of this.sql.prepare("SELECT path,sha256 FROM documents WHERE workspace_id = ? AND deleted = 0").all(request.workspace_id) as Row[]) documentHashes[String(row.path)] = String(row.sha256);
    const snapshot = this.sql.prepare("SELECT hash FROM snapshots WHERE workspace_id = ?").get(request.workspace_id) as Row | undefined;
    return { known: !!previous, event_cursors: eventCursors, decision_hashes: decisionHashes, document_hashes: documentHashes, snapshot_hash: (snapshot?.hash as string | undefined) ?? null };
  }

  getWorkspace(id: string): Row | undefined {
    return this.sql.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Row | undefined;
  }

  listWorkspaces(archived: boolean, now: number, recentDays: number, all = false): Row[] {
    const archiveFilter = archived ? "archived_at IS NOT NULL" : "archived_at IS NULL";
    const visibility = all ? "1=1" : "(status = 'ONLINE' OR last_seen_at >= ?)";
    const args = all ? [] : [iso(now - recentDays * 86_400_000)];
    return this.sql.prepare(`SELECT * FROM workspaces WHERE ${archiveFilter} AND ${visibility}`).all(...args) as Row[];
  }

  workspaceIndex(): WorkspaceIndexEntry[] {
    return (this.sql.prepare("SELECT id,name,status,last_seen_at FROM workspaces ORDER BY id").all() as Row[])
      .map((row) => ({ workspace_id: String(row.id), name: String(row.name), status: row.status as WorkspaceIndexEntry["status"], last_seen_at: row.last_seen_at as string | null }));
  }

  markWorkspaceSeen(id: string, now: number): boolean {
    const result = this.sql.prepare("UPDATE workspaces SET status = 'ONLINE', last_seen_at = ? WHERE id = ?").run(iso(now), id);
    if (Number(result.changes)) {
      const session = this.sql.prepare("SELECT id FROM workspace_sessions WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 1").get(id) as Row | undefined;
      if (session) this.sql.prepare("UPDATE workspace_sessions SET ended_at = NULL, end_reason = NULL WHERE id = ?").run(session.id);
    }
    return Number(result.changes) > 0;
  }

  goodbye(id: string, sessionId: string, now: number): boolean {
    const timestamp = iso(now);
    const result = this.sql.prepare("UPDATE workspace_sessions SET ended_at = ?, end_reason = 'goodbye' WHERE workspace_id = ? AND id = ? AND ended_at IS NULL").run(timestamp, id, sessionId);
    if (Number(result.changes)) {
      this.sql.prepare("UPDATE workspaces SET status = 'STOPPED', last_seen_at = ? WHERE id = ?").run(timestamp, id);
      this.audit(id, "connector", "workspace.goodbye", sessionId, null, now);
    }
    return Number(result.changes) > 0;
  }

  markOffline(now: number): string[] {
    const cutoff = iso(now - 90_000);
    const rows = this.sql.prepare("SELECT id FROM workspaces WHERE status = 'ONLINE' AND last_seen_at <= ?").all(cutoff) as Row[];
    const timestamp = iso(now);
    const update = this.sql.prepare("UPDATE workspaces SET status = 'OFFLINE' WHERE id = ?");
    const close = this.sql.prepare("UPDATE workspace_sessions SET ended_at = ?, end_reason = 'timeout' WHERE workspace_id = ? AND ended_at IS NULL");
    for (const row of rows) {
      update.run(row.id);
      close.run(timestamp, row.id);
      this.audit(String(row.id), "system", "workspace.offline", String(row.id), null, now);
    }
    return rows.map((row) => String(row.id));
  }

  saveSnapshot(workspaceId: string, snapshot: Snapshot, now: number): string {
    const body = JSON.stringify(snapshot);
    const digest = hash(canonicalJson(snapshot));
    this.sql.prepare(`INSERT INTO snapshots (workspace_id,body,hash,received_at) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id) DO UPDATE SET body=excluded.body,hash=excluded.hash,received_at=excluded.received_at`)
      .run(workspaceId, body, digest, iso(now));
    const upsert = this.sql.prepare(`INSERT INTO runs (workspace_id,run_id,status,created_at,finished_at,finish_result,body,title,goal) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,run_id) DO UPDATE SET status=excluded.status,created_at=excluded.created_at,finished_at=excluded.finished_at,
      finish_result=excluded.finish_result,body=excluded.body,title=excluded.title,goal=excluded.goal`);
    for (const run of snapshot.runs) upsert.run(workspaceId, run.run_id, run.status, run.created_at, run.finish?.at ?? null, run.finish?.result ?? null,
      JSON.stringify(run), run.title, run.goal);
    this.sql.prepare("UPDATE workspaces SET orchestrator_last_activity_at=? WHERE id=?")
      .run(snapshot.orchestrator_last_activity_at, workspaceId);
    this.audit(workspaceId, "connector", "snapshot.updated", workspaceId, { runs: snapshot.runs.length }, now);
    return digest;
  }

  getSnapshot(workspaceId: string): Snapshot | null {
    const row = this.sql.prepare("SELECT body FROM snapshots WHERE workspace_id = ?").get(workspaceId) as Row | undefined;
    if (!row) return null;
    const snapshot = JSON.parse(String(row.body)) as Snapshot;
    snapshot.runs = this.listRuns(workspaceId);
    return snapshot;
  }

  listRuns(workspaceId: string): Run[] {
    return (this.sql.prepare("SELECT body FROM runs WHERE workspace_id=? ORDER BY created_at DESC,run_id DESC LIMIT 200").all(workspaceId) as Row[])
      .map((row) => JSON.parse(String(row.body)) as Run);
  }

  sweepFinishedRuns(now: number, retentionDays: number): number {
    const cutoff = iso(now - retentionDays * 86_400_000);
    const expired = this.sql.prepare(`SELECT workspace_id,run_id FROM runs WHERE status IN ('DONE','FAILED')
      AND ((finished_at IS NOT NULL AND finished_at <= ?) OR (finished_at IS NULL AND created_at IS NOT NULL AND created_at <= ?))`).all(cutoff, cutoff) as Row[];
    this.sql.exec("BEGIN");
    try {
      for (const row of expired) {
        const workspaceId = String(row.workspace_id);
        const runId = String(row.run_id);
        this.sql.prepare("DELETE FROM decisions WHERE workspace_id=? AND run_id=?").run(workspaceId, runId);
        this.sql.prepare("DELETE FROM events WHERE workspace_id=? AND run_id=?").run(workspaceId, runId);
        this.sql.prepare("DELETE FROM documents WHERE workspace_id=? AND run_id=?").run(workspaceId, runId);
        this.sql.prepare("DELETE FROM runs WHERE workspace_id=? AND run_id=?").run(workspaceId, runId);
      }
      this.sql.exec("COMMIT");
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
    return expired.length;
  }

  getSnapshotHash(workspaceId: string): string | null {
    const row = this.sql.prepare("SELECT hash FROM snapshots WHERE workspace_id = ?").get(workspaceId) as Row | undefined;
    return (row?.hash as string | undefined) ?? null;
  }

  upsertDecisions(workspaceId: string, decisions: Decision[], now: number): { changed: string[]; pruned: string[]; deletedDocuments: string[] } {
    const changed: string[] = [];
    const pruned: string[] = [];
    const deletedDocuments: string[] = [];
    const statement = this.sql.prepare(`INSERT INTO decisions (workspace_id,run_id,decision_id,kind,task_id,agent,title,question,options,followup,recommend,local_status,answer,consumed_by,opened_at,updated_at,content_hash,body)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,run_id,decision_id) DO UPDATE SET kind=excluded.kind,task_id=excluded.task_id,agent=excluded.agent,title=excluded.title,question=excluded.question,options=excluded.options,followup=excluded.followup,recommend=excluded.recommend,local_status=excluded.local_status,answer=excluded.answer,consumed_by=excluded.consumed_by,opened_at=excluded.opened_at,updated_at=excluded.updated_at,content_hash=excluded.content_hash,body=excluded.body`);
    for (const decision of decisions) {
      const content = canonicalJson(decision);
      const digest = hash(content);
      const existing = this.sql.prepare("SELECT content_hash FROM decisions WHERE workspace_id = ? AND run_id = ? AND decision_id = ?")
        .get(workspaceId, decision.run_id, decision.decision_id) as Row | undefined;
      if (existing?.content_hash !== digest) changed.push(`${decision.run_id}/${decision.decision_id}`);
      statement.run(workspaceId, decision.run_id, decision.decision_id, decision.kind, decision.task_id, decision.agent, decision.title,
        decision.question, JSON.stringify(decision.options), decision.followup ? JSON.stringify(decision.followup) : null, decision.recommend,
        decision.local_status, decision.answer ? JSON.stringify(decision.answer) : null, decision.consumed_by, decision.opened_at, iso(now), digest, JSON.stringify(decision));
    }
    if (decisions.some((decision) => decision.run_id === "inbox")) {
      const inbox = this.sql.prepare("SELECT decision_id,local_status FROM decisions WHERE workspace_id=? AND run_id='inbox' ORDER BY opened_at DESC,decision_id DESC")
        .all(workspaceId) as Row[];
      for (const row of inbox.slice(100)) {
        if (row.local_status === "PENDING") continue;
        const decisionId = String(row.decision_id);
        this.sql.prepare("DELETE FROM decisions WHERE workspace_id=? AND run_id='inbox' AND decision_id=?").run(workspaceId, decisionId);
        pruned.push(`inbox/${decisionId}`);
        const path = `.orchestrator/runs/inbox/decisions/${decisionId}.md`;
        if (this.deleteDocument(workspaceId, path, now)) deletedDocuments.push(path);
      }
    }
    if (decisions.length) this.audit(workspaceId, "connector", "decisions.synced", null, { count: decisions.length }, now);
    return { changed, pruned, deletedDocuments };
  }

  listDecisionBodies(workspaceId: string): Decision[] {
    return (this.sql.prepare("SELECT body FROM decisions WHERE workspace_id = ? ORDER BY opened_at DESC,run_id,decision_id").all(workspaceId) as Row[])
      .map((row) => JSON.parse(String(row.body)) as Decision);
  }

  getDecisionBody(workspaceId: string, runId: string, decisionId: string): Decision | undefined {
    const row = this.sql.prepare("SELECT body FROM decisions WHERE workspace_id = ? AND run_id = ? AND decision_id = ?").get(workspaceId, runId, decisionId) as Row | undefined;
    return row ? JSON.parse(String(row.body)) as Decision : undefined;
  }

  insertEvents(workspaceId: string, batch: EventsBatch, now: number): number {
    const insert = this.sql.prepare("INSERT OR IGNORE INTO events (workspace_id,run_id,n,kind,body,at) VALUES (?,?,?,?,?,?)");
    let inserted = 0;
    for (const event of batch.events) inserted += Number(insert.run(workspaceId, batch.run_id, event.n, event.kind, JSON.stringify(event), event.at).changes);
    if (inserted) this.audit(workspaceId, "connector", "events.synced", batch.run_id, { count: inserted }, now);
    const row = this.sql.prepare("SELECT MAX(n) AS n FROM events WHERE workspace_id = ? AND run_id = ?").get(workspaceId, batch.run_id) as Row | undefined;
    return Number(row?.n ?? 0);
  }

  upsertDocuments(workspaceId: string, documents: Document[], now: number): string[] {
    const paths: string[] = [];
    const statement = this.sql.prepare(`INSERT INTO documents (workspace_id,path,run_id,kind,title,format,content,sha256,bytes,truncated,updated_at,deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0)
      ON CONFLICT(workspace_id,path) DO UPDATE SET run_id=excluded.run_id,kind=excluded.kind,title=excluded.title,format=excluded.format,content=excluded.content,sha256=excluded.sha256,bytes=excluded.bytes,truncated=excluded.truncated,updated_at=excluded.updated_at,deleted=0`);
    for (const document of documents) {
      const contentHash = hash(Buffer.from(document.content, "utf8"));
      if (contentHash !== document.sha256) throw Object.assign(new Error(`sha256 mismatch for ${document.path}`), { code: "bad_request" });
      statement.run(workspaceId, document.path, document.run_id, document.kind, document.title, document.format, document.content, contentHash,
        Buffer.byteLength(document.content, "utf8"), document.truncated ? 1 : 0, iso(now));
      paths.push(document.path);
    }
    if (paths.length) this.audit(workspaceId, "connector", "documents.synced", null, { paths }, now);
    return paths;
  }

  deleteDocument(workspaceId: string, path: string, now: number): boolean {
    const changed = Number(this.sql.prepare("UPDATE documents SET deleted=1 WHERE workspace_id=? AND path=? AND deleted=0").run(workspaceId, path).changes) > 0;
    if (changed) this.audit(workspaceId, "connector", "document.deleted", path, null, now);
    return changed;
  }

  listDocuments(workspaceId: string, runId?: string): Row[] {
    const sql = runId
      ? "SELECT * FROM documents WHERE workspace_id=? AND run_id=? AND deleted=0 ORDER BY updated_at DESC,path"
      : "SELECT * FROM documents WHERE workspace_id=? AND deleted=0 ORDER BY updated_at DESC,path";
    return this.sql.prepare(sql).all(...(runId ? [workspaceId, runId] : [workspaceId])) as Row[];
  }

  getDocument(workspaceId: string, path: string): Row | undefined {
    return this.sql.prepare("SELECT * FROM documents WHERE workspace_id=? AND path=? AND deleted=0").get(workspaceId, path) as Row | undefined;
  }

  createCommand(input: { workspaceId: string; type: Command["type"]; runId: string | null; decisionId: string | null; body: object; by: string; now: number; expiresAt: number | null }): UserCommand {
    const id = `cmd_${id16()}`;
    const createdAt = iso(input.now);
    const expiresAt = input.expiresAt === null ? null : iso(input.expiresAt);
    this.sql.prepare("INSERT INTO commands (id,workspace_id,type,run_id,decision_id,body,status,by,created_at,expires_at) VALUES (?,?,?,?,?,?,'QUEUED',?,?,?)")
      .run(id, input.workspaceId, input.type, input.runId, input.decisionId, JSON.stringify(input.body), input.by, createdAt, expiresAt);
    this.audit(input.workspaceId, input.by, "command.created", id, { type: input.type, run_id: input.runId, decision_id: input.decisionId }, input.now);
    return { id, workspace_id: input.workspaceId, type: input.type, run_id: input.runId, decision_id: input.decisionId,
      body: input.body, status: "QUEUED", status_reason: null, by: input.by, created_at: createdAt, delivered_at: null, expires_at: expiresAt };
  }

  listCommands(workspaceId: string): UserCommand[] {
    return (this.sql.prepare("SELECT * FROM commands WHERE workspace_id=? ORDER BY created_at DESC,id DESC").all(workspaceId) as Row[]).map((row) => this.userCommand(row));
  }

  latestDecisionCommand(workspaceId: string, runId: string, decisionId: string): UserCommand | undefined {
    const row = this.sql.prepare("SELECT * FROM commands WHERE workspace_id=? AND run_id=? AND decision_id=? AND type IN ('answer','reply') ORDER BY created_at DESC,id DESC LIMIT 1")
      .get(workspaceId, runId, decisionId) as Row | undefined;
    return row ? this.userCommand(row) : undefined;
  }

  latestAnswerCommand(workspaceId: string, runId: string, decisionId: string): UserCommand | undefined {
    const row = this.sql.prepare("SELECT * FROM commands WHERE workspace_id=? AND run_id=? AND decision_id=? AND type='answer' ORDER BY created_at DESC,id DESC LIMIT 1")
      .get(workspaceId, runId, decisionId) as Row | undefined;
    return row ? this.userCommand(row) : undefined;
  }

  getUserCommand(workspaceId: string, id: string): UserCommand | undefined {
    const row = this.sql.prepare("SELECT * FROM commands WHERE workspace_id=? AND id=?").get(workspaceId, id) as Row | undefined;
    return row ? this.userCommand(row) : undefined;
  }

  pollCommands(workspaceId: string, now: number): Command[] {
    const rows = this.sql.prepare(`SELECT * FROM commands WHERE workspace_id=? AND (expires_at IS NULL OR expires_at > ?)
      AND (status='QUEUED' OR (status='HELD' AND last_ack_at < ?)) ORDER BY created_at,id LIMIT 50`)
      .all(workspaceId, iso(now), iso(now - 5_000)) as Row[];
    return rows.map((row) => ({ id: String(row.id), type: row.type as Command["type"], run_id: row.run_id as string | null,
      decision_id: row.decision_id as string | null, body: JSON.parse(String(row.body)), by: String(row.by ?? "unknown"),
      created_at: String(row.created_at), expires_at: row.expires_at as string | null }));
  }

  ackCommand(workspaceId: string, id: string, ack: AckRequest, now: number): UserCommand | undefined {
    const row = this.sql.prepare("SELECT * FROM commands WHERE workspace_id=? AND id=?").get(workspaceId, id) as Row | undefined;
    if (!row) return undefined;
    if (["DELIVERED", "REJECTED", "FAILED", "EXPIRED"].includes(String(row.status))) return this.userCommand(row);
    const timestamp = iso(now);
    const delivered = ack.status === "DELIVERED" ? timestamp : null;
    this.sql.prepare("UPDATE commands SET status=?,status_reason=?,delivered_at=?,last_ack_at=? WHERE id=?").run(ack.status, ack.reason, delivered, timestamp, id);
    this.audit(workspaceId, "connector", "command.acked", id, { status: ack.status, reason: ack.reason }, now);
    return this.getUserCommand(workspaceId, id);
  }

  expireCommands(now: number): Array<{ workspaceId: string; id: string }> {
    const expired = this.sql.prepare("SELECT workspace_id,id FROM commands WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('QUEUED','HELD')").all(iso(now)) as Row[];
    const update = this.sql.prepare("UPDATE commands SET status='EXPIRED',status_reason='expired',last_ack_at=? WHERE id=? AND status IN ('QUEUED','HELD')");
    for (const row of expired) {
      update.run(iso(now), row.id);
      this.audit(String(row.workspace_id), "system", "command.expired", String(row.id), null, now);
    }
    return expired.map((row) => ({ workspaceId: String(row.workspace_id), id: String(row.id) }));
  }

  updateArchived(workspaceId: string, archived: boolean, now: number): boolean {
    return Number(this.sql.prepare("UPDATE workspaces SET archived_at=? WHERE id=?").run(archived ? iso(now) : null, workspaceId).changes) > 0;
  }

  private userCommand(row: Row): UserCommand {
    return { id: String(row.id), workspace_id: String(row.workspace_id), type: row.type as UserCommand["type"], run_id: row.run_id as string | null,
      decision_id: row.decision_id as string | null, body: JSON.parse(String(row.body)), status: row.status as UserCommand["status"],
      status_reason: row.status_reason as string | null, by: row.by as string | null, created_at: String(row.created_at),
      delivered_at: row.delivered_at as string | null, expires_at: row.expires_at as string | null };
  }
}
