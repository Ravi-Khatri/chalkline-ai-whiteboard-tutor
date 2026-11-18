import { useState } from 'react';
import type { QuizQuestion } from '../../shared/types.ts';
import { Check, X } from './Icons.tsx';

export function QuizPanel({ quiz, onExplain }: { quiz: QuizQuestion[]; onExplain: (q: QuizQuestion, chosen: number) => void }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.map(() => null));

  if (!quiz.length) return <p className="muted pad">No practice questions for this lesson.</p>;
  const answered = answers.filter((a) => a !== null).length;
  const correct = answers.filter((a, i) => a === quiz[i].answer).length;

  return (
    <div className="quiz">
      <p className="muted small">
        Check your understanding. {answered === quiz.length ? `You got ${correct} of ${quiz.length}.` : `${answered} of ${quiz.length} answered.`}
      </p>
      {quiz.map((q, qi) => {
        const chosen = answers[qi];
        const done = chosen !== null;
        return (
          <fieldset key={qi} className="quiz-q">
            <legend>
              <span className="step-num">{qi + 1}</span> {q.q}
            </legend>
            {q.options.map((opt, oi) => {
              const state = !done ? '' : oi === q.answer ? 'is-correct' : oi === chosen ? 'is-wrong' : 'is-dim';
              return (
                <button
                  key={oi}
                  className={`quiz-opt ${state}`}
                  disabled={done}
                  onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                  aria-label={`${opt}${done && oi === q.answer ? ' (correct answer)' : ''}${done && oi === chosen && oi !== q.answer ? ' (your answer, incorrect)' : ''}`}
                >
                  <span className="quiz-letter" aria-hidden="true">
                    {done && oi === q.answer ? <Check width={16} height={16} /> : done && oi === chosen ? <X width={16} height={16} /> : String.fromCharCode(65 + oi)}
                  </span>
                  {opt}
                </button>
              );
            })}
            {done && (
              <div className={`quiz-feedback ${chosen === q.answer ? 'good' : 'bad'}`} role="status">
                <strong>{chosen === q.answer ? 'Correct.' : 'Not quite.'}</strong> {q.why}
                {chosen !== q.answer && (
                  <button className="link-btn" onClick={() => onExplain(q, chosen!)}>
                    Ask the tutor to explain my mistake
                  </button>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
