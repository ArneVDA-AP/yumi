import { useCallback, useRef, useState } from "react";

/** Copy-to-clipboard hook with a transient "copied" flag. */
export function useCopy(resetMs = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const copy = useCallback(
    (text: string) => {
      const done = () => {
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        done();
      }
    },
    [resetMs],
  );

  return [copied, copy];
}
