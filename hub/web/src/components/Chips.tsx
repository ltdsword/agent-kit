import type { DecisionKind } from '@/api/types';
import { DECISION_KIND, type StatusLook } from '@/lib/status';
import { Icon } from './Icon';

const TONE_CLASS: Record<StatusLook['tone'], string> = {
  running: 'c-running', idle: 'c-idle', review: 'c-review', blocked: 'c-blocked', done: 'c-done',
  'done-solid': 'c-done-solid', 'blocked-solid': 'c-blocked-solid', offline: 'c-offline',
  routine: 'c-routine', needs: 'c-needs', outline: 'c-outline', 'accent-outline': 'c-accent-outline',
};

/** Status chip: icon + label + tone. `label` overrides the default text (e.g. "Offline · last seen 4 min ago"). */
export function StatusChip({ look, label, mono, large }: { look: StatusLook; label?: string; mono?: boolean; large?: boolean }) {
  return (
    <span className={`chip ${TONE_CLASS[look.tone]}${mono ? ' task-chip' : ''}${large ? ' chip-lg' : ''}`}>
      <Icon name={look.icon} />
      {label ?? look.label}
    </span>
  );
}

export function KindChip({ kind }: { kind: DecisionKind }) {
  const k = DECISION_KIND[kind];
  return (
    <span className={`kind ${k.className}`}>
      <Icon name={k.icon} />
      {kind}
    </span>
  );
}

export function PlainChip({ children }: { children: React.ReactNode }) {
  return <span className="chip c-outline">{children}</span>;
}

export function NeedsBadge({ count, large, onClick }: { count: number; large?: boolean; onClick?: () => void }) {
  const text = `${count} decision${count === 1 ? '' : 's'}`;
  const cls = `needs${large ? ' needs-lg' : ''}`;
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        <Icon name="bell" size={large ? 'lg' : undefined} />
        {text}
      </button>
    );
  }
  return (
    <span className={cls}>
      <Icon name="bell" />
      {text}
    </span>
  );
}
