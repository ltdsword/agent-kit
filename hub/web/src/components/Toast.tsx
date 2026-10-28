import { useEffect, useState } from 'react';
import { useHub } from '@/state/HubProvider';
import { Icon } from './Icon';

/** Shows the latest live-event notice for a few seconds. Screen readers hear it via aria-live. */
export function Toast() {
  const { notice } = useHub();
  const [visible, setVisible] = useState<typeof notice>(undefined);

  useEffect(() => {
    if (!notice) return;
    setVisible(notice);
    const t = setTimeout(() => setVisible(undefined), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div aria-live="polite" role="status">
      {visible && (
        <div className="toast" key={visible.id}>
          <Icon name="info" />
          <span>{visible.text}</span>
        </div>
      )}
    </div>
  );
}
