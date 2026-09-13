import { useEffect, useRef } from 'react';

export interface PinKeypadHandlers {
  onDigit: (d: string) => void;
  /** Delete the last digit (Backspace). */
  onBackspace: () => void;
  /** Clear all digits (Escape). */
  onClear: () => void;
  /** Submit the entered PIN (Enter). */
  onSubmit: () => void;
}

/**
 * Physical-keyboard support for the on-screen PIN pads: digits work from
 * either the numpad or the number row, Backspace deletes the last digit,
 * Enter submits and Escape clears. Keystrokes aimed at text fields are
 * ignored, so the hook is safe next to real inputs.
 *
 * Handlers are called through a ref, so they always see the latest state
 * (no stale closures) while the window listener is attached once.
 */
export function usePinKeypad(handlers: PinKeypadHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      ) {
        return;
      }
      const h = ref.current;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        h.onDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        h.onBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        h.onClear();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        h.onSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
