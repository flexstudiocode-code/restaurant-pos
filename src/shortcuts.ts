// Shared helpers for the desktop keyboard-first flow.

/** True when a keyboard event is aimed at a text field — global shortcuts
 *  should stand down so normal typing (digits, Enter…) keeps working. */
export function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
