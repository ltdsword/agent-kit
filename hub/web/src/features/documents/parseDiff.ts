export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx';
  oldNo?: number;
  newNo?: number;
  text: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  hunks: DiffLine[][];
}

/** Minimal unified-diff parser: enough for file list, +/− counts and hunks. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffLine[] | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(raw);
      file = { path: m?.[1] ?? raw.slice(11), added: 0, removed: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file || raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('index ')) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      hunk = [{ kind: 'hunk', text: raw }];
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (raw.startsWith('+')) { hunk.push({ kind: 'add', newNo: newNo++, text: raw.slice(1) }); file.added++; }
    else if (raw.startsWith('-')) { hunk.push({ kind: 'del', oldNo: oldNo++, text: raw.slice(1) }); file.removed++; }
    else if (raw.startsWith(' ')) hunk.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
  }
  return files;
}
