import type { ReactNode } from 'react';

export const PAGE_SIZE = 30;

export function pageCount(itemCount: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function pageItems<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): T[] {
  const currentPage = Math.min(Math.max(page, 1), pageCount(items.length, pageSize));
  return items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
}

export function Pager({ page, totalItems, onPageChange, pageSize = PAGE_SIZE }: {
  page: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
}) {
  const pages = pageCount(totalItems, pageSize);
  const currentPage = Math.min(Math.max(page, 1), pages);
  return (
    <nav aria-label="Pagination" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}>Previous</button>
      <span className="t-small" aria-live="polite">page {currentPage} of {pages}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={currentPage === pages}
        onClick={() => onPageChange(currentPage + 1)}>Next</button>
    </nav>
  );
}

export function MoreButton({ onClick, children = '→ More…' }: { onClick: () => void; children?: ReactNode }) {
  return <button type="button" className="btn btn-ghost btn-sm" onClick={onClick}>{children}</button>;
}
