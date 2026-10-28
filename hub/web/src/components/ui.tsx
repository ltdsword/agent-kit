import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* Small presentational building blocks. No data fetching here. */

export type BannerTone = 'neutral' | 'stale' | 'info' | 'error' | 'needs';
const BANNER_CLASS: Record<BannerTone, string> = { neutral: '', stale: 'b-stale', info: 'b-info', error: 'b-error', needs: 'b-needs' };

export function Banner({ tone = 'neutral', icon, children, action, full, role }: {
  tone?: BannerTone; icon: IconName; children: ReactNode; action?: ReactNode; full?: boolean; role?: 'status' | 'alert';
}) {
  return (
    <div className={`banner ${BANNER_CLASS[tone]}${full ? ' banner-full' : ''}`} role={role} style={action ? { alignItems: 'center', flexWrap: 'wrap' } : undefined}>
      <Icon name={icon} />
      <span style={{ flex: 1, minWidth: 200 }}>{children}</span>
      {action}
    </div>
  );
}

export interface Step { label: string; state: 'done' | 'cur' | 'wait' | 'bad' | 'todo'; icon?: IconName }

/** Sent → Delivered → Applied. Each step has an icon and a label (never color alone). */
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s, i) => (
        <StepItem key={s.label} step={s} first={i === 0} lineDone={s.state === 'done' || (s.state === 'cur' && i > 0)} />
      ))}
    </ol>
  );
}

function StepItem({ step, first, lineDone }: { step: Step; first: boolean; lineDone: boolean }) {
  return (
    <>
      {!first && <li className={`step-line${lineDone ? ' done' : ''}`} aria-hidden="true" />}
      <li className={`step ${step.state === 'todo' ? '' : step.state}`} aria-current={step.state === 'cur' || step.state === 'wait' ? 'step' : undefined}>
        <span className="dot">{step.icon && <Icon name={step.icon} />}</span>
        {step.label}
      </li>
    </>
  );
}

/** Expandable terminal-style tail of an agent's screen. */
export function TerminalTail({ title, text, defaultOpen, hint }: { title: string; text: string; defaultOpen?: boolean; hint?: string }) {
  return (
    <details className="tail" open={defaultOpen}>
      <summary>
        <Icon name="terminal" />
        {title}
        {hint && <span className="t-small" style={{ marginLeft: 'auto', fontWeight: 400 }}>{hint}</span>}
        <Icon name="chevron-down" style={hint ? undefined : { marginLeft: 'auto' }} />
      </summary>
      <pre className="term">{text}</pre>
    </details>
  );
}

export function Crumbs({ items }: { items: { label: string; to?: string; mono?: boolean }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <Icon name="chevron-right" size="sm" />}
          {it.to ? (
            <Link to={it.to} className={it.mono ? 'mono' : undefined}>{it.label}</Link>
          ) : (
            <span className={it.mono ? 'mono' : undefined} style={{ color: 'var(--text)', fontWeight: 600 }} aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div style={{ padding: '20px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span className="doc-ico" style={{ color: 'var(--status-done)' }}><Icon name={icon} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong>{title}</strong>
        {children && <span className="t-2">{children}</span>}
      </span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden="true">
      <div className="sk" style={{ height: 20, width: '50%' }} />
      <div className="sk" style={{ height: 44 }} />
      <div className="sk" style={{ height: 14, width: '80%' }} />
      <div className="sk" style={{ height: 14, width: '60%' }} />
    </div>
  );
}

export function SectionCard({ title, icon, right, children, id, tone }: {
  title: ReactNode; icon?: IconName; right?: ReactNode; children: ReactNode; id?: string; tone?: 'needs';
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section id={id} className="card" aria-labelledby={headingId} style={tone === 'needs' ? { borderColor: 'var(--needs-you-line)' } : undefined}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          background: tone === 'needs' ? 'var(--needs-you-soft)' : undefined,
          borderRadius: '10px 10px 0 0', borderBottom: tone === 'needs' ? '1px solid var(--needs-you-line)' : undefined,
        }}
      >
        {icon && <Icon name={icon} size="lg" style={tone === 'needs' ? { color: 'var(--needs-you)' } : undefined} />}
        <h2 id={headingId} className="t-h2">{title}</h2>
        {right && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>{right}</span>}
      </div>
      {children}
    </section>
  );
}
