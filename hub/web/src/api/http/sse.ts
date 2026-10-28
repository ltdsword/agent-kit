export interface SSEMessage {
  event: string;
  data: string;
}

/** Incremental parser for the event and data fields used by the protocol stream. */
export class SSEParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];

  push(chunk: string): SSEMessage[] {
    this.buffer += chunk;
    const messages: SSEMessage[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.readLine(line, messages);
      newline = this.buffer.indexOf('\n');
    }
    return messages;
  }

  finish(): SSEMessage[] {
    const messages: SSEMessage[] = [];
    if (this.buffer) this.readLine(this.buffer.replace(/\r$/, ''), messages);
    this.buffer = '';
    this.dispatch(messages);
    return messages;
  }

  private readLine(line: string, messages: SSEMessage[]): void {
    if (!line) {
      this.dispatch(messages);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') this.event = value;
    if (field === 'data') this.data.push(value);
  }

  private dispatch(messages: SSEMessage[]): void {
    if (this.data.length) messages.push({ event: this.event || 'message', data: this.data.join('\n') });
    this.event = '';
    this.data = [];
  }
}
