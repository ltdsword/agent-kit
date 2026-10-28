import type { Workspace } from '@/api/types';
import { ago } from '@/lib/time';

/** "Running", "Offline · last seen 4 min ago", "Stopped yesterday 18:20" */
export function workspaceStatusLabel(w: Workspace, now: number): string {
  if (w.status === 'OFFLINE') return `Offline · last seen ${ago(w.lastSeenAt, now)}`;
  if (w.status === 'STOPPED') return `Stopped ${ago(w.lastSeenAt, now)}`;
  return 'Running';
}
