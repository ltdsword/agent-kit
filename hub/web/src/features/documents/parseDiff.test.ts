import { describe, expect, it } from 'vitest';
import { parseDiff } from './parseDiff';

const SAMPLE = `diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 keep
-old
+new
+more
`;

describe('parseDiff', () => {
  it('counts additions and removals per file', () => {
    const [f] = parseDiff(SAMPLE);
    expect(f).toMatchObject({ path: 'x.txt', added: 2, removed: 1 });
    expect(f!.hunks[0]!.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'del', 'add', 'add']);
  });
});
