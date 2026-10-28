import type {
  AgentLiveState, DecisionKind, DecisionStatus, GateStatus, PromptStatus, RunStatus, TaskStatus,
  WorkerStatus, WorkspaceStatus,
} from '@/api/types';
import type { IconName } from '@/components/Icon';

/**
 * Single source of truth for how every status looks: CSS tone class + icon + label.
 * Never use color alone: every chip has an icon and a text label.
 */
export type Tone =
  | 'running' | 'idle' | 'review' | 'blocked' | 'done' | 'done-solid' | 'blocked-solid'
  | 'offline' | 'routine' | 'needs' | 'outline' | 'accent-outline';

export interface StatusLook {
  tone: Tone;
  icon: IconName;
  label: string;
}

const look = (tone: Tone, icon: IconName, label: string): StatusLook => ({ tone, icon, label });

export const WORKSPACE_STATUS: Record<WorkspaceStatus, StatusLook> = {
  RUNNING: look('running', 'activity', 'Running'),
  OFFLINE: look('offline', 'wifi-off', 'Offline'),
  STOPPED: look('offline', 'power', 'Stopped'),
};

export const AGENT_STATE: Record<AgentLiveState, StatusLook> = {
  idle: look('idle', 'pause', 'Idle'),
  working: look('running', 'activity', 'Working'),
  blocked: look('blocked', 'octagon', 'Blocked on a terminal prompt'),
  unknown: look('offline', 'unknown', 'Unknown'),
  off: look('offline', 'power', 'Not running'),
};

export const TASK_STATUS: Record<TaskStatus, StatusLook> = {
  PENDING: look('idle', 'unknown', 'PENDING'),
  READY: look('accent-outline', 'play', 'READY'),
  RUNNING: look('running', 'activity', 'RUNNING'),
  REVIEW: look('outline', 'eye', 'REVIEW'),
  FIX_REQUIRED: look('review', 'wrench', 'FIX_REQUIRED'),
  PASSED: look('done', 'check', 'PASSED'),
  MERGED: look('done-solid', 'merge', 'MERGED'),
  BLOCKED: look('blocked', 'octagon', 'BLOCKED'),
  FAILED: look('blocked-solid', 'x-circle', 'FAILED'),
};

export const WORKER_STATUS: Record<WorkerStatus, StatusLook> = {
  IDLE: look('idle', 'pause', 'Idle'),
  BUSY: look('running', 'activity', 'Busy'),
  BLOCKED: look('blocked', 'octagon', 'Blocked'),
  BROKEN: look('blocked-solid', 'x-circle', 'Broken'),
};

export const RUN_STATUS: Record<RunStatus, StatusLook> = {
  RUNNING: look('running', 'activity', 'Running'),
  DONE: look('done', 'check', 'Done'),
  MERGED: look('done-solid', 'merge', 'Done'),
  BLOCKED: look('blocked', 'octagon', 'Blocked'),
  FAILED: look('blocked-solid', 'x-circle', 'Failed'),
};

export const GATE_STATUS: Record<GateStatus, StatusLook> = {
  NOT_RUN: look('offline', 'unknown', 'Not run yet'),
  PASSED: look('done', 'check', 'Passed'),
  FAILED: look('blocked', 'x-circle', 'Failed'),
};

export const DECISION_STATUS: Record<DecisionStatus, StatusLook> = {
  OPEN: look('needs', 'bell', 'Open'),
  REPLY_SENT: look('running', 'message', 'Reply sent'),
  SENT: look('running', 'send', 'Sent'),
  WAITING: look('review', 'clock', 'Waiting for your computer'),
  DELIVERED: look('done', 'check', 'Delivered'),
  APPLIED: look('done-solid', 'check', 'Applied'),
  ANSWERED_ELSEWHERE: look('offline', 'terminal', 'Answered in the terminal'),
  REJECTED: look('blocked', 'alert', 'Rejected'),
  CANCELLED: look('offline', 'ban', 'Cancelled by Opus'),
  ROUTINE: look('routine', 'hub', 'Routine'),
};

export const PROMPT_STATUS: Record<PromptStatus, StatusLook> = {
  QUEUED: look('idle', 'clock', 'Queued'),
  DELIVERED: look('done', 'check', 'Delivered'),
  HELD: look('review', 'hold', 'Held'),
  EXPIRED: look('offline', 'clock', 'Expired'),
  FAILED: look('blocked', 'alert', 'Failed'),
};

export const DECISION_KIND: Record<DecisionKind, { className: string; icon: IconName }> = {
  blocker: { className: 'k-blocker', icon: 'octagon' },
  repair: { className: 'k-repair', icon: 'wrench' },
  scope_exception: { className: 'k-scope', icon: 'alert' },
  abandon: { className: 'k-abandon', icon: 'x-circle' },
  worker_approval: { className: 'k-approval', icon: 'terminal' },
  question: { className: 'k-question', icon: 'message' },
  finish: { className: 'k-finish', icon: 'merge' },
};

/** Decisions the user still has to act on. */
export const NEEDS_YOU: ReadonlySet<DecisionStatus> = new Set(['OPEN', 'REPLY_SENT', 'REJECTED']);
/** Answered, on the way to the computer. */
export const IN_FLIGHT: ReadonlySet<DecisionStatus> = new Set(['SENT', 'WAITING', 'DELIVERED']);
