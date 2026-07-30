"use client";

import { useId, useState } from "react";

type Props = Omit<React.ComponentProps<"input">, "type"> & {
  /** Extra classes for the wrapper, not the input. */
  wrapperClassName?: string;
};

/**
 * A password input with a reveal toggle.
 *
 * Long generated passwords and six-digit PINs are easy to mistype and
 * impossible to check once masked, and a crew member entering a PIN is often
 * one-handed outdoors. Being able to look at what you typed prevents more
 * lockouts than masking prevents shoulder-surfing on a phone.
 */
export default function PasswordField({
  className,
  wrapperClassName,
  ...inputProps
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const labelId = useId();

  return (
    <div className={`relative ${wrapperClassName ?? ""}`}>
      <input
        {...inputProps}
        type={revealed ? "text" : "password"}
        className={`${className ?? ""} pr-16`}
      />
      <button
        type="button"
        // Never a submit button: this sits inside a form, and a stray Enter
        // must send the form rather than toggle visibility.
        onClick={() => setRevealed((v) => !v)}
        aria-pressed={revealed}
        aria-label={revealed ? "Hide password" : "Show password"}
        id={labelId}
        className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
      >
        {revealed ? "Hide" : "Show"}
      </button>
    </div>
  );
}
