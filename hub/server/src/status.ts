import type { Decision, HistoryItem, HubDecision, WorkspaceSummary, WorkspaceStatus } from "@agent-hub/protocol";
import type { HubDatabase, Row } from "./db.ts";

export function decisionStatus(
  decision: Decision,
  latest: ReturnType<HubDatabase["latestDecisionCommand"]>,
  latestAnswer: ReturnType<HubDatabase["latestAnswerCommand"]> = latest?.type === "answer" ? latest : undefined,
): { status: HubDecision["hub_status"]; reason: string | null } {
  if (decision.local_status === "DECIDED_BY_OPUS") return { status: "ROUTINE", reason: null };
  if (decision.local_status === "CANCELLED") return { status: "CANCELLED", reason: decision.cancel_reason };
  if (decision.local_status === "ANSWERED") {
    // A question needs no follow-up command: once Opus has the answer it is final, so nothing will ever consume it.
    if (decision.consumed_by || decision.kind === "question") return { status: "APPLIED", reason: null };
    if (decision.answer?.channel === "hub") return { status: "DELIVERED", reason: null };
    if (decision.answer?.channel === "chat") return { status: "ANSWERED_ELSEWHERE", reason: null };
    return { status: "APPLIED", reason: null };
  }
  if (decision.answer === null && decision.local_status === "PENDING" && latest?.type === "reply" && latest.status === "DELIVERED") {
    return { status: "REPLY_SENT", reason: null };
  }
  if (latestAnswer) {
    if (["QUEUED", "HELD", "DELIVERED"].includes(latestAnswer.status)) return { status: "SENT", reason: latestAnswer.status === "HELD" ? latestAnswer.status_reason : null };
    if (latestAnswer.status === "REJECTED") return { status: "REJECTED", reason: latestAnswer.status_reason };
  }
  return { status: "OPEN", reason: null };
}

export function hubDecision(db: HubDatabase, workspaceId: string, decision: Decision): HubDecision {
  const latest = db.latestDecisionCommand(workspaceId, decision.run_id, decision.decision_id);
  const latestAnswer = db.latestAnswerCommand(workspaceId, decision.run_id, decision.decision_id);
  const derived = decisionStatus(decision, latest, latestAnswer);
  return {
    workspace_id: workspaceId,
    hub_status: derived.status,
    status_reason: derived.reason,
    updated_at: latest?.created_at ?? decision.opened_at,
    pending_command: latest ?? null,
    decision,
  };
}

export function workspaceSummary(db: HubDatabase, row: Row, kitVersion?: string): WorkspaceSummary {
  const id = String(row.id);
  const snapshot = db.getSnapshot(id);
  const active = snapshot?.runs.find((run) => run.status === "RUNNING" || run.status === "BLOCKED");
  const open = db.listDecisionBodies(id).filter((decision) => ["OPEN", "SENT", "REJECTED"].includes(hubDecision(db, id, decision).hub_status)).length;
  const status = row.status as WorkspaceStatus;
  return {
    id,
    name: String(row.name),
    path: row.path as string | null,
    status,
    last_seen_at: row.last_seen_at as string | null,
    kit_version: row.kit_version as string | null,
    kit_outdated: kitVersion ? row.kit_version !== kitVersion : false,
    open_decisions: open,
    problems: active?.problems.length ?? 0,
    orchestrator_state: snapshot?.orchestrator.herdr_state ?? null,
    active_run: active ? { run_id: active.run_id, status: active.status, title: active.title } : null,
    archived: row.archived_at !== null,
    upload: row.upload ? JSON.parse(String(row.upload)) : null,
    orchestrator_last_activity_at: row.orchestrator_last_activity_at as string | null,
    computer_id: null,
    computer_online: true,
  };
}

export function workspaceDetail(db: HubDatabase, row: Row, kitVersion?: string) {
  const workspace = workspaceSummary(db, row, kitVersion);
  const decisions_open = db.listDecisionBodies(workspace.id)
    .map((decision) => hubDecision(db, workspace.id, decision))
    .filter((decision) => ["OPEN", "SENT", "REJECTED"].includes(decision.hub_status));
  return { workspace, snapshot: db.getSnapshot(workspace.id), decisions_open, commands_recent: db.listCommands(workspace.id).slice(0, 50) };
}

export function historyItems(db: HubDatabase, workspaceId: string): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const decision of db.listDecisionBodies(workspaceId)) {
    const state = hubDecision(db, workspaceId, decision);
    if (decision.local_status === "DECIDED_BY_OPUS") {
      items.push({ id: `h_${decision.run_id}_${decision.decision_id}`, at: decision.opened_at, type: "routine", run_id: decision.run_id,
        decision_id: decision.decision_id, title: decision.title, choice: null, label: null, text: decision.answer?.note || decision.cancel_reason,
        quote: null, channel: "opus", by: null, status: state.hub_status });
    } else if (decision.answer && ["hub", "chat"].includes(decision.answer.channel)) {
      const option = decision.options.find((candidate) => candidate.key === decision.answer?.choice);
      items.push({ id: `h_${decision.run_id}_${decision.decision_id}`, at: decision.answer.at, type: "answer", run_id: decision.run_id,
        decision_id: decision.decision_id, title: decision.title, choice: decision.answer.choice, label: option?.label ?? decision.answer.label,
        text: decision.answer.note || null, quote: decision.answer.quote, channel: decision.answer.channel, by: decision.answer.by, status: state.hub_status });
    }
  }
  for (const command of db.listCommands(workspaceId)) {
    if (command.type !== "reply" && command.type !== "prompt") continue;
    items.push({ id: `h_${command.id}`, at: command.created_at, type: command.type, run_id: command.run_id, decision_id: command.decision_id,
      title: null, choice: null, label: null, text: typeof command.body.text === "string" ? command.body.text : null, quote: null,
      channel: "hub", by: command.by, status: command.status });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
