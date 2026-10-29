import type {
  Answer as ProtocolAnswer, DocumentContent, HubDecision, HubDecisionStatus, HistoryItem, List, Run as ProtocolRun,
  Snapshot, UserCommand, WorkspaceDetail, WorkspaceSummary,
} from '../protocol';
import type {
  Answer, Channel, Decision, DecisionStatus, GateStatus, HistoryEntry, HubDocument,
  PastRun, Problem, Prompt, PromptStatus, Run, RunStatus, Scout, Task, UploadSettings,
  Workspace, WorkspaceStatus, Worker,
} from '../types';

const timestamp = (value: string | null | undefined): number => value ? Date.parse(value) : 0;

export async function collectPages<T>(fetchPage: (cursor: string | null) => Promise<List>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items as T[]);
    cursor = page.next;
  } while (cursor);
  return items;
}

export function mapWorkspaceStatus(status: WorkspaceSummary['status']): WorkspaceStatus {
  return status === 'ONLINE' ? 'RUNNING' : status;
}

function mapAgentState(state: Snapshot['orchestrator']['herdr_state'] | null): Workspace['orchestrator']['state'] {
  if (state === 'absent') return 'off';
  if (state === 'done') return 'idle';
  return state ?? 'unknown';
}

function mapGate(status: ProtocolRun['gate']['status']): GateStatus {
  return status === 'PASS' ? 'PASSED' : status === 'FAIL' ? 'FAILED' : 'NOT_RUN';
}

function mapRunStatus(run: ProtocolRun): RunStatus {
  if (run.status !== 'DONE' || !run.finish) return run.status;
  const result = run.finish.result.toLowerCase();
  return /\bmerge/.test(result) && !/\bnot merged\b|\bdon't merge\b|\bdo not merge\b/.test(result) ? 'MERGED' : 'DONE';
}

function mapTask(task: ProtocolRun['tasks'][number]): Task {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary ?? '',
    status: task.status,
    worker: task.worker ?? undefined,
    fixRound: task.major_repairs ? `${task.major_repairs}/${task.max_repairs}` : undefined,
    dependsOn: task.depends_on,
  };
}

function mapProblem(problem: ProtocolRun['problems'][number]): Problem {
  const severity = problem.type === 'BLOCKED' || problem.type === 'FAILED' ? 'blocked' : 'warn';
  return {
    text: problem.task_id ? `${problem.task_id}: ${problem.type}` : problem.type,
    note: problem.note,
    severity,
    decisionId: problem.decision_id ?? undefined,
  };
}

function mapRun(run: ProtocolRun): Run {
  return {
    id: run.run_id,
    title: run.title ?? run.run_id,
    goal: run.goal ?? '',
    status: mapRunStatus(run),
    integrationBranch: run.integration_branch,
    gate: mapGate(run.gate.status),
    outcome: run.finish?.result ?? undefined,
    tasks: run.tasks.map(mapTask),
    problems: run.problems.map(mapProblem),
  };
}

function mapPastRun(run: ProtocolRun): PastRun {
  return {
    id: run.run_id,
    status: mapRunStatus(run),
    outcome: run.finish?.result ?? '',
    date: run.finish ? new Date(run.finish.at).toLocaleDateString() : '',
  };
}

function mapUploads(upload: WorkspaceSummary['upload']): UploadSettings {
  return {
    documents: upload?.documents ?? false,
    diffs: upload?.diffs ?? false,
    orchestratorScreen: upload?.orchestrator_screen ?? false,
  };
}

function mapWorker(worker: Snapshot['workers'][number]): Worker {
  const live = mapAgentState(worker.herdr_state);
  return {
    slot: worker.slot,
    status: worker.status,
    taskId: worker.task_id ?? undefined,
    live,
    sinceAt: timestamp(worker.since),
    model: [worker.kind, worker.model].filter(Boolean).join(' · '),
    reason: worker.status_reason ?? undefined,
  };
}

function mapScout(snapshot: Snapshot | null): Scout | undefined {
  if (!snapshot?.scout) return undefined;
  return {
    roundsUsed: snapshot.scout.rounds_used,
    maxRounds: snapshot.scout.max_rounds,
    ready: snapshot.scout.readiness === 'READY',
    rounds: snapshot.scout.rounds.map((round) => ({
      name: `Round ${round.n}`,
      questions: round.questions,
      docId: round.evidence_path ?? '',
    })),
  };
}

export function mapWorkspaceSummary(summary: WorkspaceSummary, snapshot: Snapshot | null = null): Workspace {
  const runs = snapshot?.runs ?? [];
  const activeId = summary.active_run?.run_id;
  const current = activeId ? runs.find((run) => run.run_id === activeId) : undefined;
  const lastActivityAt = timestamp(snapshot?.orchestrator_last_activity_at ?? summary.orchestrator_last_activity_at);
  const status = mapWorkspaceStatus(summary.status);
  const orchestratorState = snapshot?.orchestrator.herdr_state ?? summary.orchestrator_state;
  return {
    id: summary.id,
    name: summary.name,
    path: summary.path ?? '',
    status,
    lastSeenAt: timestamp(summary.last_seen_at),
    kitVersion: summary.kit_version ?? '',
    archived: summary.archived,
    computerId: summary.computer_id,
    computerOnline: summary.computer_online,
    uploads: mapUploads(summary.upload),
    orchestrator: snapshot ? {
      program: snapshot.orchestrator.name,
      model: snapshot.orchestrator.model,
      effort: snapshot.orchestrator.effort ?? '',
      state: mapAgentState(snapshot.orchestrator.herdr_state),
      lastActivityAt,
      screen: snapshot.orchestrator.screen?.join('\n') ?? undefined,
    } : {
      program: '', model: '', effort: '', state: mapAgentState(orchestratorState), lastActivityAt,
    },
    run: current ? mapRun(current) : undefined,
    pastRuns: runs.filter((run) => run.finish !== null).map(mapPastRun),
    workers: snapshot?.workers.map(mapWorker) ?? [],
    scout: mapScout(snapshot),
  };
}

export function mapWorkspaceDetail(detail: WorkspaceDetail): Workspace {
  return mapWorkspaceSummary(detail.workspace, detail.snapshot);
}

function mapChannel(channel: HistoryItem['channel'] | ProtocolAnswer['channel']): Channel {
  if (channel === 'chat') return 'terminal';
  if (channel === 'opus') return 'routine';
  return channel ?? 'hub';
}

function mapAnswer(answer: ProtocolAnswer): Answer {
  return {
    choice: answer.choice,
    label: answer.label,
    note: answer.note || undefined,
    branch: answer.followup?.value,
    quote: answer.quote ?? undefined,
    channel: mapChannel(answer.channel),
    by: answer.by || undefined,
    at: timestamp(answer.at),
  };
}

function mapDecisionStatus(status: HubDecisionStatus, workspaceStatus: WorkspaceStatus): DecisionStatus {
  if (status === 'SENT' && workspaceStatus === 'OFFLINE') return 'WAITING';
  return status;
}

export function mapDecision(item: HubDecision, workspaceStatus: WorkspaceStatus): Decision {
  const source = item.decision;
  const command = item.pending_command;
  return {
    workspaceId: item.workspace_id,
    runId: source.run_id,
    id: source.decision_id,
    kind: source.kind,
    agent: source.agent,
    taskId: source.task_id ?? undefined,
    title: source.title,
    question: source.question,
    evidence: source.evidence,
    options: source.options.map((option) => ({ ...option, consequence: option.consequence ?? '' })),
    followup: source.followup ? {
      when: source.followup.when,
      question: source.followup.question,
      options: source.followup.options.map((option) => ({
        key: option.key, label: option.label, value: option.value ?? undefined, input: !!option.input,
      })),
    } : undefined,
    recommend: source.recommend ?? undefined,
    status: mapDecisionStatus(item.hub_status, workspaceStatus),
    openedAt: timestamp(source.opened_at),
    answer: source.answer ? mapAnswer(source.answer) : undefined,
    replyText: command?.type === 'reply' ? command.body.text : undefined,
    rejectReason: item.hub_status === 'REJECTED' ? item.status_reason ?? undefined : undefined,
    cancelReason: source.cancel_reason ?? undefined,
    deliveredAt: timestamp(command?.delivered_at),
    appliedAt: item.hub_status === 'APPLIED' ? timestamp(item.updated_at) : undefined,
    approval: source.approval ? {
      command: source.approval.command, cwd: source.approval.cwd, why: source.approval.why,
    } : undefined,
    opusNote: source.note ?? undefined,
  };
}

export function mapDecisions(items: HubDecision[], workspaceStatus: WorkspaceStatus): Decision[] {
  return items.map((item) => mapDecision(item, workspaceStatus)).sort((a, b) => b.openedAt - a.openedAt);
}

function mapPromptStatus(status: UserCommand['status']): PromptStatus {
  return status === 'REJECTED' ? 'FAILED' : status;
}

export function mapPrompt(command: UserCommand): Prompt | null {
  if (command.type !== 'prompt') return null;
  return {
    id: command.id,
    workspaceId: command.workspace_id,
    text: command.body.text ?? '',
    status: mapPromptStatus(command.status),
    reason: command.status_reason ?? undefined,
    createdAt: timestamp(command.created_at),
  };
}

export function mapHistoryItem(item: HistoryItem, workspaceId: string): HistoryEntry {
  if (item.type === 'prompt') {
    return {
      id: item.id, workspaceId, at: timestamp(item.at), type: 'prompt', runId: item.run_id ?? '',
      promptId: item.id, by: item.by ?? undefined,
    };
  }
  if (item.type === 'routine') {
    return {
      id: item.id, workspaceId, at: timestamp(item.at), type: 'routine', runId: item.run_id ?? '',
      text: item.title ?? item.text ?? 'Routine decision', reason: item.text ?? '',
    };
  }
  return {
    id: item.id, workspaceId, at: timestamp(item.at), type: 'answer', runId: item.run_id ?? '',
    decisionId: item.decision_id ?? '', choice: item.choice ?? undefined, label: item.label ?? undefined,
    quote: item.type === 'reply' ? item.text ?? item.quote ?? undefined : item.quote ?? undefined,
    replyOnly: item.type === 'reply', channel: mapChannel(item.channel), by: item.by ?? undefined,
  };
}

const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export function mapDocumentContent(workspaceId: string, value: DocumentContent): HubDocument {
  return {
    id: value.meta.path,
    workspaceId,
    runId: value.meta.run_id ?? '',
    kind: value.meta.kind,
    name: fileName(value.meta.path),
    title: value.meta.title,
    format: value.meta.format,
    bytes: value.meta.bytes,
    truncated: value.meta.truncated,
    updatedAt: timestamp(value.meta.updated_at),
    content: value.content,
  };
}
