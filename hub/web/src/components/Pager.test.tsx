import { describe, expect, it } from 'vitest';
import { pageCount, pageItems } from './Pager';

describe('shared pager boundaries', () => {
  it('keeps zero and thirty rows on one page', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageItems([], 1)).toEqual([]);
    expect(pageCount(30)).toBe(1);
    expect(pageItems(Array.from({ length: 30 }, (_, index) => index), 1)).toHaveLength(30);
  });

  it('puts row 31 on the second page', () => {
    const rows = Array.from({ length: 31 }, (_, index) => index);
    expect(pageCount(rows.length)).toBe(2);
    expect(pageItems(rows, 1)).toHaveLength(30);
    expect(pageItems(rows, 2)).toEqual([30]);
  });
});
