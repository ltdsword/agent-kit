import { describe, expect, it } from 'vitest';
import { SSEParser } from './sse';

describe('SSEParser', () => {
  it('parses named events split across chunks', () => {
    const parser = new SSEParser();
    expect(parser.push('event: dec')).toEqual([]);
    expect(parser.push('ision\ndata: {"id":')).toEqual([]);
    expect(parser.push('"ws_1"}\n\n')).toEqual([{ event: 'decision', data: '{"id":"ws_1"}' }]);
  });

  it('parses multiple events and joins data lines', () => {
    const parser = new SSEParser();
    expect(parser.push('event: document\ndata: first\ndata: second\n\nevent: history\ndata: third\n\n')).toEqual([
      { event: 'document', data: 'first\nsecond' },
      { event: 'history', data: 'third' },
    ]);
  });

  it('flushes an event without a final newline', () => {
    const parser = new SSEParser();
    parser.push('event: workspace\ndata: payload');
    expect(parser.finish()).toEqual([{ event: 'workspace', data: 'payload' }]);
  });
});
