import { decisionKey } from '@/api/client';
import type { Decision, HubSnapshot, Workspace } from '@/api/types';
import { IN_FLIGHT, NEEDS_YOU } from '@/lib/status';

/** Pure functions over a snapshot. Easy to unit-test; components stay thin. */

const STATUS_ORDER: Record<Workspace['status'], number> = { RUNNING: 0, OFFLINE: 1, STOPPED: 2 };

export function visibleWorkspaces(s: HubSnapshot): Workspace[] {
  return s.workspaces.filter((w) => !w.archived).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

export function workspaceById(s: HubSnapshot, id: string | undefined): Workspace | undefined {
  return s.workspaces.find((w) => w.id === id);
}

export function needsYou(s: HubSnapshot, workspaceId?: string): Decision[] {
  return s.decisions
    .filter((d) => NEEDS_YOU.has(d.status) && (!workspaceId || d.workspaceId === workspaceId))
    .filter((d) => !s.workspaces.find((w) => w.id === d.workspaceId)?.archived)
    .sort((a, b) => a.openedAt - b.openedAt);
}

export function inFlight(s: HubSnapshot, workspaceId: string): Decision[] {
  return s.decisions.filter((d) => d.workspaceId === workspaceId && IN_FLIGHT.has(d.status));
}

export function findDecision(s: HubSnapshot, workspaceId?: string, runId?: string, decisionId?: string): Decision | undefined {
  if (!workspaceId || !runId || !decisionId) return undefined;
  const key = decisionKey(workspaceId, runId, decisionId);
  return s.decisions.find((d) => keyOf(d) === key);
}

export function keyOf(d: Decision): string {
  return decisionKey(d.workspaceId, d.runId, d.id);
}

export function decisionPath(d: Pick<Decision, 'workspaceId' | 'runId' | 'id'>): string {
  return `/w/${d.workspaceId}/d/${d.runId}/${d.id}`;
}

export function documentsByRun(s: HubSnapshot, workspaceId: string) {
  const docs = s.documents.filter((d) => d.workspaceId === workspaceId);
  const runs = [...new Set(docs.map((d) => d.runId))].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  return runs.map((runId) => ({ runId, docs: docs.filter((d) => d.runId === runId) }));
}
