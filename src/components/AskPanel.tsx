import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Sparkle, X } from './Icons.tsx';

export interface ChatMessage {
  role: 'user' | 'tutor' | 'error';
  text: string;
}

export function AskPanel({
  messages,
  busy,
  selectedLabel,
  onClearSelection,
  onAsk,
  onResume,
  canResume,
  inputRef,
  draft,
  setDraft,
}: {
  messages: ChatMessage[];
  busy: boolean;
  selectedLabel?: string;
  onClearSelection: () => void;
  onAsk: (q: string) => void;
  onResume: () => void;
  canResume: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const q = draft.trim();
    if (!q || busy) return;
    onAsk(q);
    setDraft('');
    setTouched(false);
  };

  const suggestions = selectedLabel
    ? [`What does "${selectedLabel}" mean?`, `Why is "${selectedLabel}" important here?`]
    : ['Can you explain that again more simply?', 'Can you give me another example?', 'Why does this work?'];

  return (
    <div className="ask">
      <div className="ask-log" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="ask-empty">
            <Sparkle width={22} height={22} />
            <p>
              Ask anything about what you're seeing. The lesson pauses, the tutor answers out loud, and you carry on from the same moment.
            </p>
            <p className="muted small">Tip: click something on the board to ask about it specifically.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <span className="sr-only">{m.role === 'user' ? 'You' : m.role === 'tutor' ? 'Tutor' : 'Error'}: </span>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="msg msg-tutor msg-typing" aria-label="Tutor is thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {canResume && !busy && (
        <button className="btn btn-ghost resume-btn" onClick={onResume}>
          Resume lesson
        </button>
      )}

      <div className="ask-suggestions">
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => onAsk(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      <form className="ask-form" onSubmit={submit}>
        {selectedLabel && (
          <div className="ask-context">
            <span>
              Asking about <strong>{selectedLabel}</strong>
            </span>
            <button type="button" className="icon-btn small" onClick={onClearSelection} aria-label="Stop asking about this item">
              <X width={16} height={16} />
            </button>
          </div>
        )}
        <label htmlFor="ask-input" className="sr-only">
          Your question for the tutor
        </label>
        <div className="ask-row">
          <textarea
            id="ask-input"
            ref={inputRef}
            rows={2}
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            placeholder="Ask the tutor a question…"
            aria-invalid={touched && !draft.trim()}
            aria-describedby="ask-help"
          />
          <button className="send-btn" type="submit" disabled={busy || !draft.trim()} aria-label="Send question">
            <Send />
          </button>
        </div>
        <p id="ask-help" className="muted small">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </div>
  );
}
