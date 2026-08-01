import { useState, useRef, useEffect } from 'react';

// Small (i) icon that reveals a help popup on click (not hover-only — has to
// work on touch/mobile per the standing responsive rule) instead of a long
// instructional paragraph sitting permanently on the page. Click anywhere
// outside, or the icon again, to close. `text` may include line breaks
// (rendered as-is via CSS white-space) for multi-sentence help copy.
export default function InfoTooltip({ text, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Help"
        title="Help"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%', border: '1px solid #8892A6',
          color: '#5c6070', background: '#fff', fontSize: 12, fontWeight: 700,
          lineHeight: 1, cursor: 'pointer', padding: 0, verticalAlign: 'middle',
        }}
      >
        i
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 50, top: '150%', left: 0,
            width: 300, maxWidth: '80vw', background: '#fff', color: '#333',
            border: '1px solid #ccc', borderRadius: 8, padding: '10px 12px',
            fontSize: 13, fontWeight: 400, lineHeight: 1.4, whiteSpace: 'pre-wrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
