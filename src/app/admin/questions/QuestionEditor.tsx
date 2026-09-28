"use client";

import { useActionState } from "react";
import { deleteQuestion, saveQuestion } from "./actions";

export type EditableQuestion = {
  id: string;
  question: string;
  email: string | null;
  answer: string | null;
  published: boolean;
  askedOn: string;
};

export default function QuestionEditor({
  q,
  questionMax,
  answerMax,
}: {
  q: EditableQuestion;
  questionMax: number;
  answerMax: number;
}) {
  const [state, action, pending] = useActionState(saveQuestion, undefined);

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>Asked {q.askedOn}</span>
        {q.email ? (
          <a
            href={`mailto:${q.email}?subject=${encodeURIComponent("Your question about GroundsRoute")}`}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Reply to {q.email}
          </a>
        ) : (
          <span>No email left</span>
        )}
        {q.published && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">
            Published
          </span>
        )}
      </div>

      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="id" value={q.id} />
        <div>
          <label htmlFor={`question-${q.id}`} className="mb-1 block text-sm font-medium">
            Question <span className="font-normal text-muted">(edit before publishing if needed)</span>
          </label>
          <textarea
            id={`question-${q.id}`}
            name="question"
            defaultValue={q.question}
            required
            maxLength={questionMax}
            rows={2}
            className="field"
          />
        </div>
        <div>
          <label htmlFor={`answer-${q.id}`} className="mb-1 block text-sm font-medium">
            Answer
          </label>
          <textarea
            id={`answer-${q.id}`}
            name="answer"
            defaultValue={q.answer ?? ""}
            maxLength={answerMax}
            rows={4}
            className="field"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" defaultChecked={q.published} />
          Show on the public FAQ page
        </label>

        {state && "error" in state && (
          <p role="alert" className="text-sm text-danger">{state.error}</p>
        )}
        {state && "ok" in state && (
          <p role="status" className="text-sm text-muted">{state.ok}</p>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="submit"
            formAction={deleteQuestion}
            formNoValidate
            className="btn btn-secondary"
            onClick={(e) => {
              if (!confirm("Delete this question for good?")) e.preventDefault();
            }}
          >
            Delete
          </button>
        </div>
      </form>
    </article>
  );
}
