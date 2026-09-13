import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { isDesktop } from '../desktop';

function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  useEscapeClose(open, onClose);
  if (!open) return null;
  // Portal to <body>: an ancestor transform (item-card :active scale) would
  // otherwise trap this fixed overlay and fling it off-screen mid-press.
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        {title && (
          <h2 style={{ margin: '0 0 12px', fontSize: 16.5 }}>{title}</h2>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscapeClose(open, onClose);
  if (!open) return null;
  // Portal to <body>: an ancestor transform (item-card :active scale) would
  // otherwise trap this fixed overlay and fling it off-screen mid-press.
  return createPortal(
    <div
      className={`sheet-overlay${isDesktop() ? ' desktop' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet-handle" />
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Switch({
  on,
  onChange,
  label,
  sub,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <div className="switch" onClick={() => onChange(!on)} role="switch" aria-checked={on} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!on); } }}>
      <div className="grow">
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{label}</div>
        {sub && <div className="small muted">{sub}</div>}
      </div>
      <button
        type="button"
        className={`switch-track ${on ? 'on' : ''}`}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="big">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

/** Horizontally scrollable chip row; shows a right-edge fade only when the
 *  content actually overflows, so it is obvious the row can be swiped.
 *  Pass `wrap` to make the chips wrap to multiple lines instead of scrolling. */
export function Chips({ children, style, wrap }: { children: ReactNode; style?: CSSProperties; wrap?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  useEffect(() => {
    if (wrap) return;
    const el = ref.current;
    if (!el) return;
    const check = () => setCanScroll(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrap]);
  return (
    <div ref={ref} className={`chips${wrap ? ' wrap' : canScroll ? ' can-scroll' : ''}`} style={style}>
      {children}
    </div>
  );
}

/**
 * In-app text prompt (replaces window.prompt, which is not supported in the
 * Android WebView used by the APK — window.prompt silently returns null there).
 */
export function Prompt({
  open,
  title,
  placeholder,
  initial = '',
  multiline = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  placeholder?: string;
  initial?: string;
  multiline?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2 style={{ margin: '0 0 12px', fontSize: 16.5 }}>{title}</h2>
        {multiline ? (
          <textarea
            className="textarea"
            autoFocus
            rows={3}
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            className="input"
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary grow" onClick={() => { onSubmit(value.trim()); }}>
            Save
          </button>
          <button className="btn btn-ghost grow" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
