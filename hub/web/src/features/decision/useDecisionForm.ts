import { useEffect, useState } from 'react';
import type { AnswerInput, Decision } from '@/api/types';

/** Client-side check before sending. The scheduler still validates (git check-ref-format) and may reject. */
export function branchError(text: string): string | null {
  const b = text.trim();
  if (!b) return 'Type a branch name.';
  if (b.startsWith('agent/')) return 'agent/ branches are reserved for the kit.';
  return null;
}

/** All form state for one decision, kept apart from rendering so it is easy to test and change. */
export function useDecisionForm(d: Decision | undefined) {
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [branchMode, setBranchMode] = useState<'this' | 'other'>('this');
  const [branchText, setBranchText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');

  // A rejected answer re-opens the form with what was sent, so it can be fixed in place.
  const rejected = d?.status === 'REJECTED' ? d.answer : undefined;
  useEffect(() => {
    if (!rejected) return;
    setPicked(rejected.choice);
    setNote(rejected.note ?? '');
    if (rejected.branch && rejected.branch !== 'main') {
      setBranchMode('other');
      setBranchText(rejected.branch);
    }
  }, [rejected]);

  const isFinish = d?.kind === 'finish';
  const needsBranch = isFinish && (picked === 'A' || picked === 'B');
  const branch = needsBranch ? (branchMode === 'this' ? 'main' : branchText.trim()) : undefined;
  const bErr = needsBranch && branchMode === 'other' ? branchError(branchText) : null;

  const canReview = !chatOpen && !!picked && !bErr;
  const canReply = chatOpen && chatText.trim().length > 0;

  const toInput = (): AnswerInput => ({ choice: picked!, note: note.trim() || undefined, branch });

  return {
    picked, note, branchMode, branchText, chatOpen, chatText,
    needsBranch, branch, branchError: bErr, canReview, canReply, toInput,
    pick: (key: string) => { setPicked(key); setChatOpen(false); },
    setNote, setBranchMode, setBranchText, setChatText,
    openChat: () => { setChatOpen(true); setPicked(null); },
    closeChat: () => setChatOpen(false),
    clearChat: () => { setChatText(''); setChatOpen(false); },
  };
}

export type DecisionFormState = ReturnType<typeof useDecisionForm>;
