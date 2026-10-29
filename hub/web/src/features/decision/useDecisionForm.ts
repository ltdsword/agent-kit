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
    if (rejected.branch && rejected.branch !== d?.followup?.options.find((o) => !o.input)?.value) {
      setBranchMode('other');
      setBranchText(rejected.branch);
    }
  }, [rejected]);

  // The followup options come from the decision itself: a fixed one (this branch) and a typed one.
  const followup = d?.followup;
  const thisOpt = followup?.options.find((o) => !o.input && o.value);
  const otherOpt = followup?.options.find((o) => o.input);
  const thisBranch = thisOpt?.value;
  const mode = thisOpt ? branchMode : 'other';
  const needsBranch = !!picked && !!followup?.when.includes(picked);
  const branch = needsBranch ? (mode === 'this' ? thisBranch : branchText.trim()) : undefined;
  const bErr = needsBranch && mode === 'other' ? branchError(branchText) : null;

  const canReview = !chatOpen && !!picked && !bErr;
  const canReply = chatOpen && chatText.trim().length > 0;

  const toInput = (): AnswerInput => ({
    choice: picked!, note: note.trim() || undefined, branch,
    followup: needsBranch ? (mode === 'this' ? thisOpt : otherOpt)?.key : undefined,
    value: needsBranch && mode === 'other' ? branch : undefined,
  });

  return {
    picked, note, branchMode: mode, branchText, chatOpen, chatText, thisBranch,
    needsBranch, branch, branchError: bErr, canReview, canReply, toInput,
    pick: (key: string) => { setPicked(key); setChatOpen(false); },
    setNote, setBranchMode, setBranchText, setChatText,
    openChat: () => { setChatOpen(true); setPicked(null); },
    closeChat: () => setChatOpen(false),
    clearChat: () => { setChatText(''); setChatOpen(false); },
  };
}

export type DecisionFormState = ReturnType<typeof useDecisionForm>;
