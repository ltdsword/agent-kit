import type { DecisionOption } from '@/api/types';
import { Icon } from '@/components/Icon';

/** Large radio card: key, label, one-line consequence. Recommended gets the star line. */
export function OptionCard({ name, option, recommended, selected, onSelect }: {
  name: string; option: DecisionOption; recommended: boolean; selected: boolean; onSelect: () => void;
}) {
  return (
    <label className={`opt${selected ? ' sel' : ''}`}>
      <input type="radio" name={name} value={option.key} checked={selected} onChange={onSelect} />
      <span className="key">{option.key}</span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        {recommended && <span className="rec"><Icon name="star" />Recommended by Opus</span>}
        <span className="lbl">{option.label}</span>
        <span className="cons">{option.consequence}</span>
      </span>
      <span className="radio" aria-hidden="true" />
    </label>
  );
}

/** Recommended option first, the rest in key order. */
export function orderOptions(options: DecisionOption[], recommend?: string): DecisionOption[] {
  return [...options].sort((a, b) => {
    if (a.key === recommend) return -1;
    if (b.key === recommend) return 1;
    return a.key.localeCompare(b.key);
  });
}
