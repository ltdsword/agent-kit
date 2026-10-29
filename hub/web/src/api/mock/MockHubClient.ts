import { decisionKey, PROMPT_LIMIT_CHARS, type HubClient, type Simulator } from '../client';
import type {
  Answer, AnswerInput, Decision, HistoryEntry, HubSnapshot, Workspace,
} from '../types';
import {
  DIFF_R4, REPORT_R4, seedDecisions, seedDocuments, seedHistory, seedPrompts, seedWorkspaces,
} from './seed';

/**
 * In-memory stand-in for `agent-hub serve` + the connector + the scheduler.
 * It reproduces the protocol v2 decision and command state machines for development and demos.
 */
export interface MockDelays {
  load: number;
  deliver: number;
  apply: number;
  prompt: number;
  reply: number;
  finish: number;
}

const DEFAULT_DELAYS: MockDelays = { load: 700, deliver: 1300, apply: 2400, prompt: 1000, reply: 4500, finish: 2500 };
const OPEN_STATES = new Set(['OPEN', 'REPLY_SENT', 'REJECTED']);

export class MockHubClient implements HubClient, Simulator {
  private snap: HubSnapshot;
  private listeners = new Set<(s: HubSnapshot) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;
  private seq = 7;
  private noticeSeq = 0;
  private readonly delays: MockDelays;

  constructor(opts: { delays?: Partial<MockDelays>; heartbeat?: boolean } = {}) {
    this.delays = { ...DEFAULT_DELAYS, ...opts.delays };
    const now = Date.now();
    this.snap = {
      workspaces: seedWorkspaces(now), decisions: seedDecisions(now), prompts: seedPrompts(),
      history: seedHistory(), documents: seedDocuments(),
      connection: 'live', lastEventAt: now, loaded: false,
    };
    this.later(this.delays.load, () => this.set((s) => ({ ...s, loaded: true })));
    if (opts.heartbeat !== false) {
      this.heartbeat = setInterval(() => {
        if (this.snap.connection === 'live') this.set((s) => ({ ...s, lastEventAt: Date.now() }));
      }, 20_000);
    }
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.listeners.clear();
  }

  /* ---------- HubClient ---------- */

  subscribe(listener: (s: HubSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): HubSnapshot {
    return this.snap;
  }

  async answerDecision(workspaceId: string, runId: string, decisionId: string, input: AnswerInput): Promise<void> {
    this.assertConnected();
    const key = decisionKey(workspaceId, runId, decisionId);
    const d = this.decision(key);
    if (!d || !OPEN_STATES.has(d.status)) throw new Error('decision_not_open');
    const ws = this.workspace(workspaceId);
    if (!ws.computerOnline) throw new Error('computer_offline');
    if (ws.status === 'STOPPED') throw new Error('workspace_stopped');
    const opt = d.options.find((o) => o.key === input.choice);
    if (!opt) throw new Error('invalid_choice');
    const answer: Answer = {
      choice: opt.key, label: opt.label, note: input.note?.trim() || undefined,
      branch: input.branch, push: d.kind === 'finish' && opt.key === 'A',
      channel: 'hub', by: 'owner', at: Date.now(),
    };
    const online = ws.status === 'RUNNING';
    this.patchDecision(key, { answer, status: online ? 'SENT' : 'WAITING', rejectReason: undefined });
    this.addHistory({
      type: 'answer', workspaceId, runId, decisionId, choice: opt.key, label: opt.label, channel: 'hub', by: 'owner',
      extra: input.branch ? `into ${input.branch}${answer.push ? ', push' : ''}` : undefined, quote: answer.note,
    });
    if (online) this.deliver(key);
    else this.notice(`Saved. ${ws.name} is offline, so ${decisionId} waits for your computer.`);
  }

  async replyToDecision(workspaceId: string, runId: string, decisionId: string, text: string): Promise<void> {
    this.assertConnected();
    const key = decisionKey(workspaceId, runId, decisionId);
    const d = this.decision(key);
    if (!d || !OPEN_STATES.has(d.status)) throw new Error('decision_not_open');
    if (!this.workspace(workspaceId).computerOnline) throw new Error('computer_offline');
    this.patchDecision(key, { status: 'REPLY_SENT', replyText: text });
    this.addHistory({ type: 'answer', workspaceId, runId, decisionId, quote: text, replyOnly: true, channel: 'hub', by: 'owner' });
    // Opus reads the reply and records it as an option, with the user's words as the quote.
    this.later(this.delays.reply, () => {
      const cur = this.decision(key);
      if (!cur || cur.status !== 'REPLY_SENT') return;
      const opt = cur.options.find((o) => o.key === cur.recommend) ?? cur.options[0]!;
      this.patchDecision(key, {
        status: 'DELIVERED', deliveredAt: Date.now(),
        answer: { choice: opt.key, label: opt.label, quote: text, channel: 'hub', by: 'owner', at: Date.now() },
      });
      this.notice(`Opus recorded your reply on ${decisionId} as ${opt.key}, with your words.`);
      this.later(this.delays.apply, () => this.apply(key));
    });
  }

  async sendPrompt(workspaceId: string, text: string): Promise<void> {
    this.assertConnected();
    const ws = this.workspace(workspaceId);
    if (ws.status === 'STOPPED') throw new Error('workspace_not_online');
    if (!ws.computerOnline) throw new Error('computer_offline');
    if (ws.status !== 'RUNNING') throw new Error('workspace_not_online');
    if (text.length > PROMPT_LIMIT_CHARS) throw new Error('prompt_too_large');
    const id = `p${Date.now()}${Math.floor(Math.random() * 1000)}`;
    this.set((s) => ({ ...s, prompts: [{ id, workspaceId, text, status: 'QUEUED', createdAt: Date.now() }, ...s.prompts] }));
    this.addHistory({ type: 'prompt', workspaceId, runId: ws.run?.id ?? '', promptId: id });
    this.later(this.delays.prompt, () => {
      const w = this.workspace(workspaceId);
      if (w.orchestrator.state === 'blocked') {
        this.patchPrompt(id, { status: 'HELD', reason: 'The orchestrator has a prompt open in the terminal. It will be sent when that closes.' });
      } else {
        this.patchPrompt(id, { status: 'DELIVERED', reason: undefined });
        this.patchWorkspace(workspaceId, (x) => ({ ...x, orchestrator: { ...x.orchestrator, state: 'working', lastActivityAt: Date.now() } }));
      }
    });
  }

  async resendPrompt(promptId: string): Promise<void> {
    const p = this.snap.prompts.find((x) => x.id === promptId);
    if (p) await this.sendPrompt(p.workspaceId, p.text);
  }

  reconnect(): void {
    this.set((s) => ({ ...s, connection: 'live', lastEventAt: Date.now() }));
    this.notice('Reconnected. Live updates resumed.');
  }

  /* ---------- Simulator ---------- */

  actions(ctx: { workspaceId?: string; decisionKey?: string }): { label: string; run: () => void }[] {
    const list: { label: string; run: () => void }[] = [];
    const target = this.targetDecision(ctx);
    if (target) {
      const k = decisionKey(target.workspaceId, target.runId, target.id);
      list.push({ label: `Opus cancels ${target.id}`, run: () => this.simCancel(k) });
      list.push({ label: `You answer ${target.id} in the terminal`, run: () => this.simTerminal(k) });
    }
    list.push({ label: 'A new decision arrives', run: () => this.simNewDecision() });
    const thrift = this.workspace('ws_k3m9q2');
    list.push({
      label: thrift.orchestrator.state === 'blocked' ? 'Opus closes its terminal prompt' : 'Opus opens a terminal prompt (prompts get held)',
      run: () => this.simOrchestratorPrompt(),
    });
    const cur = ctx.workspaceId ? this.snap.workspaces.find((w) => w.id === ctx.workspaceId) : undefined;
    const tw = cur && cur.status !== 'STOPPED' ? cur : thrift;
    list.push({ label: tw.status === 'RUNNING' ? `${tw.name} goes offline` : `${tw.name} comes back online`, run: () => this.simToggleOnline(tw.id) });
    list.push({
      label: this.snap.connection === 'live' ? 'Hub connection drops' : 'Hub connection comes back',
      run: () => (this.snap.connection === 'live' ? this.set((s) => ({ ...s, connection: 'lost' })) : this.reconnect()),
    });
    if (!this.decision('ws_k3m9q2/r4/D6')) list.push({ label: 'Skip ahead: run r4 finishes', run: () => this.finishRun() });
    list.push({ label: 'Show the loading state', run: () => { this.set((s) => ({ ...s, loaded: false })); this.later(1500, () => this.set((s) => ({ ...s, loaded: true }))); } });
    return list;
  }

  /* ---------- internals: state ---------- */

  private set(fn: (s: HubSnapshot) => HubSnapshot): void {
    this.snap = fn(this.snap);
    this.listeners.forEach((l) => l(this.snap));
  }
  private touch(s: HubSnapshot): HubSnapshot {
    return { ...s, lastEventAt: Date.now() };
  }
  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }
  private notice(text: string): void {
    this.noticeSeq += 1;
    const id = this.noticeSeq;
    this.set((s) => ({ ...s, notice: { id, text } }));
  }
  private assertConnected(): void {
    if (this.snap.connection !== 'live') throw new Error('hub_unreachable');
  }
  private workspace(id: string): Workspace {
    const w = this.snap.workspaces.find((x) => x.id === id);
    if (!w) throw new Error(`unknown workspace ${id}`);
    return w;
  }
  private decision(key: string): Decision | undefined {
    return this.snap.decisions.find((d) => decisionKey(d.workspaceId, d.runId, d.id) === key);
  }
  private patchDecision(key: string, patch: Partial<Decision>): void {
    this.set((s) => this.touch({ ...s, decisions: s.decisions.map((d) => (decisionKey(d.workspaceId, d.runId, d.id) === key ? { ...d, ...patch } : d)) }));
  }
  private patchWorkspace(id: string, fn: (w: Workspace) => Workspace): void {
    this.set((s) => this.touch({ ...s, workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)) }));
  }
  private patchPrompt(id: string, patch: Partial<HubSnapshot['prompts'][number]>): void {
    this.set((s) => this.touch({ ...s, prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }
  private addHistory(e: DistributiveOmit<HistoryEntry, 'id' | 'at'>): void {
    const entry = { ...e, id: `h${Date.now()}${Math.random()}`, at: Date.now() } as HistoryEntry;
    this.set((s) => ({ ...s, history: [entry, ...s.history] }));
  }

  /* ---------- internals: delivery (connector + scheduler) ---------- */

  private deliver(key: string): void {
    this.patchDecision(key, { status: 'SENT' });
    this.later(this.delays.deliver, () => {
      const d = this.decision(key);
      if (!d || d.status !== 'SENT') return;
      if (this.workspace(d.workspaceId).status !== 'RUNNING') {
        this.patchDecision(key, { status: 'WAITING' });
        return;
      }
      const reason = d.answer?.branch ? invalidBranchReason(d.answer.branch) : null;
      if (reason) {
        this.patchDecision(key, { status: 'REJECTED', rejectReason: reason });
        this.notice(`${d.id} was rejected by your computer. The form is open again.`);
        return;
      }
      this.patchDecision(key, { status: 'DELIVERED', deliveredAt: Date.now() });
      this.later(this.delays.apply, () => this.apply(key));
    });
  }

  private apply(key: string): void {
    const d = this.decision(key);
    if (!d || d.status !== 'DELIVERED') return;
    this.patchDecision(key, { status: 'APPLIED', appliedAt: Date.now() });
    this.effects(d);
  }

  /** What the agents do after an answer is applied, so the dashboard visibly moves on. */
  private effects(d: Decision): void {
    const choice = d.answer?.choice ?? d.recommend ?? 'A';
    if (d.workspaceId === 'ws_k3m9q2') {
      if (d.id === 'D3') {
        this.patchWorkspace(d.workspaceId, (w) => ({
          ...w,
          orchestrator: { ...w.orchestrator, state: 'working', lastActivityAt: Date.now() },
          run: w.run && { ...w.run, tasks: w.run.tasks.map((t) => (t.id === 'T2' ? { ...t, status: choice === 'C' ? 'BLOCKED' : 'RUNNING', fixRound: choice === 'A' ? '2/2' : t.fixRound } : t)) },
          workers: w.workers.map((x) => (x.slot === 'worker-2' ? { ...x, status: choice === 'C' ? 'IDLE' : 'BUSY', live: choice === 'C' ? 'idle' : 'working', sinceAt: Date.now(), taskId: choice === 'C' ? undefined : 'T2' } : x)),
        }));
      }
      if (d.id === 'D4') {
        this.patchWorkspace(d.workspaceId, (w) => ({
          ...w,
          run: w.run && { ...w.run, problems: w.run.problems.filter((p) => p.decisionId !== 'D4') },
          workers: w.workers.map((x) => (x.slot === 'worker-3' ? {
            ...x, status: 'BUSY', live: 'working', sinceAt: Date.now(), reason: undefined,
          } : x)),
        }));
      }
      if (d.id === 'D6' && d.answer) {
        const b = d.answer.branch ?? 'main';
        const out = choice === 'A' ? `Merged into ${b} and pushed to origin/${b}.` : choice === 'B' ? `Merged into ${b} locally. Not pushed.` : 'Not merged, your choice C. agent/integration-r4 kept.';
        this.patchWorkspace(d.workspaceId, (w) => ({ ...w, run: w.run && { ...w.run, status: choice === 'C' ? 'DONE' : 'MERGED', outcome: out }, orchestrator: { ...w.orchestrator, state: 'idle', lastActivityAt: Date.now() } }));
        this.notice(`r4: ${out}`);
      }
      this.later(this.delays.finish, () => this.maybeFinishRun());
    }
    if (d.workspaceId === 'ws_q7l2a1' && d.id === 'D2') {
      this.patchWorkspace(d.workspaceId, (w) => ({
        ...w,
        run: w.run && { ...w.run, problems: [], tasks: w.run.tasks.map((t) => (t.id === 'T3' ? { ...t, status: choice === 'C' ? 'FAILED' : 'RUNNING' } : t)) },
        workers: w.workers.map((x) => ({ ...x, status: 'BUSY', live: 'working', sinceAt: Date.now() })),
      }));
    }
  }

  private maybeFinishRun(): void {
    if (this.decision('ws_k3m9q2/r4/D6')) return;
    const done = (id: string) => {
      const d = this.decision(`ws_k3m9q2/r4/${id}`);
      return !!d && ['APPLIED', 'ANSWERED_ELSEWHERE', 'CANCELLED'].includes(d.status);
    };
    if (done('D3') && done('D4')) this.finishRun();
  }

  private finishRun(): void {
    if (this.decision('ws_k3m9q2/r4/D6')) return;
    const now = Date.now();
    const finish: Decision = {
      workspaceId: 'ws_k3m9q2', runId: 'r4', id: 'D6', kind: 'finish', agent: 'orchestrator',
      title: 'Run r4 is done. Merge it?',
      question: 'All 4 tasks merged into agent/integration-r4 and the gate passed. The final report and the total diff are below.',
      evidence: [],
      options: [
        { key: 'A', label: 'Merge and push', consequence: 'Merges agent/integration-r4 into the branch below, then pushes it to origin.' },
        { key: 'B', label: 'Merge locally only, no push', consequence: 'Nothing leaves your computer. You can push later yourself.' },
        { key: 'C', label: 'Don’t merge', consequence: 'agent/integration-r4 stays as it is for you to inspect.' },
      ],
      followup: {
        when: ['A', 'B'], question: 'What branch do you choose to merge?',
        options: [
          { key: 'A', label: 'This branch (main)', value: 'main' },
          { key: 'B', label: 'Other branch (type its name; a new name creates that branch)', input: true },
        ],
      },
      recommend: 'A', status: 'OPEN', openedAt: now, appliedNote: 'Used by finish apply --decision D6.',
    };
    this.set((s) => this.touch({
      ...s,
      decisions: s.decisions.map((d) => (d.workspaceId === 'ws_k3m9q2' && ['OPEN', 'REPLY_SENT', 'REJECTED', 'SENT', 'WAITING', 'DELIVERED'].includes(d.status)
        ? { ...d, status: 'ANSWERED_ELSEWHERE' as const, answer: terminalAnswer(d) } : d)).concat(finish),
      workspaces: s.workspaces.map((w) => (w.id !== 'ws_k3m9q2' ? w : {
        ...w,
        orchestrator: { ...w.orchestrator, state: 'idle', lastActivityAt: now },
        run: w.run && { ...w.run, status: 'DONE', gate: 'PASSED', problems: [], tasks: w.run.tasks.map((t) => ({ ...t, status: 'MERGED' })) },
        workers: w.workers.map((x) => ({ ...x, status: 'IDLE', live: 'idle', taskId: undefined, sinceAt: now })),
      })),
      documents: [
        { id: 'doc_r4_report', workspaceId: 'ws_k3m9q2', runId: 'r4', kind: 'final_report', name: 'final-report.md', title: 'Final report', format: 'markdown', truncated: false, updatedAt: now, content: REPORT_R4, bytes: REPORT_R4.length },
        { id: 'doc_r4_diff', workspaceId: 'ws_k3m9q2', runId: 'r4', kind: 'final_diff', name: 'final.diff', title: 'Total diff', format: 'diff', truncated: false, updatedAt: now, content: DIFF_R4, bytes: DIFF_R4.length },
        ...s.documents,
      ],
    }));
    this.notice('New decision D6 in thrift-demo: run r4 is done. Merge it?');
  }

  /* ---------- internals: simulations ---------- */

  private targetDecision(ctx: { workspaceId?: string; decisionKey?: string }): Decision | undefined {
    const open = (d: Decision) => OPEN_STATES.has(d.status);
    if (ctx.decisionKey) {
      const d = this.decision(ctx.decisionKey);
      if (d && open(d)) return d;
    }
    return this.snap.decisions.find((d) => d.workspaceId === ctx.workspaceId && open(d)) ?? this.snap.decisions.find(open);
  }

  private simCancel(key: string): void {
    const d = this.decision(key);
    if (!d) return;
    this.patchDecision(key, { status: 'CANCELLED', cancelReason: d.id === 'D3' ? 'T1 merged first, so rebasing T2 is now a routine fix round.' : 'No longer needed after the last change.', appliedAt: Date.now() });
    this.notice(`Opus cancelled ${d.id}.`);
    this.later(this.delays.finish, () => this.maybeFinishRun());
  }

  private simTerminal(key: string): void {
    const d = this.decision(key);
    if (!d) return;
    const answer = terminalAnswer(d);
    this.patchDecision(key, { status: 'ANSWERED_ELSEWHERE', answer });
    this.addHistory({ type: 'answer', workspaceId: d.workspaceId, runId: d.runId, decisionId: d.id, choice: answer.choice, label: answer.label, channel: 'terminal', quote: answer.quote });
    this.notice(`${d.id} was answered in the terminal.`);
    this.later(1800, () => this.effects({ ...d, answer }));
  }

  private simNewDecision(): void {
    this.seq += 1;
    const id = `D${this.seq}`;
    const d: Decision = {
      workspaceId: 'ws_k3m9q2', runId: 'r4', id, kind: 'question', agent: 'orchestrator', taskId: 'T3',
      title: 'T3: keep the old request examples in the API docs?',
      question: 'The docs show examples that the new validation now rejects (a 90-character name).',
      evidence: [{ code: 'docs/api/users.md:58', note: 'example name is 90 characters' }],
      options: [
        { key: 'A', label: 'Replace them with valid examples', consequence: 'T3 rewrites 3 examples.' },
        { key: 'B', label: 'Keep them and add an error example', consequence: 'Shows the 400 response too.' },
      ],
      recommend: 'B', status: 'OPEN', openedAt: Date.now(), appliedNote: 'Opus updated T3’s task plan.',
    };
    this.set((s) => this.touch({ ...s, decisions: [...s.decisions, d] }));
    this.notice(`New decision ${id} in thrift-demo needs you.`);
  }

  private simOrchestratorPrompt(): void {
    const w = this.workspace('ws_k3m9q2');
    const wasBlocked = w.orchestrator.state === 'blocked';
    this.patchWorkspace(w.id, (x) => ({ ...x, orchestrator: { ...x.orchestrator, state: wasBlocked ? 'idle' : 'blocked', lastActivityAt: Date.now() } }));
    if (!wasBlocked) {
      this.notice('Opus has a prompt open in its terminal. New hub prompts will be held.');
      return;
    }
    const held = this.snap.prompts.filter((p) => p.workspaceId === w.id && p.status === 'HELD');
    if (held.length === 0) return;
    this.later(900, () => {
      this.set((s) => this.touch({ ...s, prompts: s.prompts.map((p) => (p.workspaceId === w.id && p.status === 'HELD' ? { ...p, status: 'DELIVERED' as const, reason: undefined } : p)) }));
      this.notice(held.length === 1 ? 'Held prompt delivered to Opus.' : `${held.length} held prompts delivered to Opus.`);
    });
  }

  private simToggleOnline(id: string): void {
    const w = this.workspace(id);
    if (w.status === 'RUNNING') {
      this.patchWorkspace(id, (x) => ({ ...x, status: 'OFFLINE', lastSeenAt: Date.now(), orchestrator: { ...x.orchestrator, state: 'unknown' } }));
      this.set((s) => ({ ...s, decisions: s.decisions.map((d) => (d.workspaceId === id && d.status === 'SENT' ? { ...d, status: 'WAITING' as const } : d)) }));
      this.notice(`${w.name} went offline. Answers wait for your computer; prompts are off.`);
      return;
    }
    this.patchWorkspace(id, (x) => ({ ...x, status: 'RUNNING', lastSeenAt: Date.now(), orchestrator: { ...x.orchestrator, state: 'idle', lastActivityAt: Date.now() } }));
    const waiting = this.snap.decisions.filter((d) => d.workspaceId === id && d.status === 'WAITING');
    waiting.forEach((d) => this.deliver(decisionKey(d.workspaceId, d.runId, d.id)));
    this.notice(`${w.name} is back online${waiting.length ? `. Delivering ${waiting.length} waiting answer${waiting.length > 1 ? 's' : ''}.` : '.'}`);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function terminalAnswer(d: Decision): Answer {
  const opt = d.options.find((o) => o.key === d.recommend) ?? d.options[0]!;
  return { choice: opt.key, label: opt.label, quote: `${opt.key}, go ahead`, channel: 'terminal', at: Date.now() };
}

/** Mirrors the scheduler's check (git check-ref-format + no agent/ branches). */
export function invalidBranchReason(branch: string): string | null {
  if (branch.startsWith('agent/')) return `Invalid branch name “${branch}”: agent/ branches are reserved for the kit.`;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.endsWith('/') || /^[/.]/.test(branch) || branch.endsWith('.lock')) {
    return `Invalid branch name “${branch}”: git check-ref-format refused it.`;
  }
  return null;
}
