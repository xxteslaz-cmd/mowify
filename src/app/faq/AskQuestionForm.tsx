"use client";

import { useActionState } from "react";
import { askQuestion } from "./actions";

export default function AskQuestionForm({ maxLength }: { maxLength: number }) {
  const [state, action, pending] = useActionState(askQuestion, undefined);

  if (state && "ok" in state) {
    return (
      <p role="status" className="text-sm text-foreground">
        Thanks — your question is in. We&apos;ll answer it here, and by email
        if you left an address.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="question" className="mb-1 block text-sm font-medium">
          Your question
        </label>
        <textarea
          id="question"
          name="question"
          required
          minLength={5}
          maxLength={maxLength}
          rows={4}
          className="field"
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          className="field"
        />
        <p className="mt-1 text-xs text-muted">
          Only if you&apos;d like a reply. It&apos;s never shown on this page.
        </p>
      </div>

      {/* The honeypot. Off-screen rather than display:none, which some bots
          know to skip; aria-hidden and tabIndex keep it away from screen
          readers and keyboard users, who would otherwise be asked to fill in
          a field that silently discards their question. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state && "error" in state && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Sending…" : "Send question"}
      </button>
    </form>
  );
}
