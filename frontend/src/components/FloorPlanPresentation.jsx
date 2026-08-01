import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadPdf } from '../utils/pdf';
import { fitBoothName, fitUniformBoothNumberSize, truncateBoothName } from '../utils/boothLabelFit';

// Fully opaque — see FloorPlan.jsx's STATUS_COLORS comment: any transparency
// here lets the hall background image's own printed booth number (common on
// a scanned/converted floor plan PDF) show faintly through ours, "ghosting"
// worse the higher you zoom in.
const STATUS_COLORS = {
  AVAILABLE: 'rgb(214, 235, 219)',
  RESERVED: 'rgb(211, 214, 242)',
  PROPOSED: 'rgb(247, 228, 187)',
  SOLD: 'rgb(243, 209, 209)',
};
const STATUS_BORDER = { AVAILABLE: '#1E7B34', RESERVED: '#4a4fb0', PROPOSED: '#8a6d1a', SOLD: '#c83c3c' };
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#000000'];
const TOOLS = [
  { key: 'hand', icon: '✋', label: 'Hand (scroll/pan)' },
  { key: 'pen', icon: '✏️', label: 'Pen' },
  { key: 'highlighter', icon: '🖍️', label: 'Highlighter' },
  { key: 'eraser', icon: '🧹', label: 'Eraser' },
  { key: 'text', icon: '🔤', label: 'Text' },
];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

let nextId = 1;
const uid = () => `p${nextId++}`;

// A safe fallback for any measurement that comes out NaN/Infinity (a booth
// with a missing dimension, a zero-size image before it's finished
// loading, etc.) — used throughout the font/eraser-radius math below so a
// single bad value can never produce an invalid style or a runtime error.
const safe = (n, fallback) => (Number.isFinite(n) ? n : fallback);

// Full-screen (via a fixed full-viewport overlay — see the "Full Screen"
// button below for true browser fullscreen, which is opt-in) read-only
// presentation view of one hall, for standing in front of a projector
// during a client/management meeting. Every annotation (strokes, text)
// lives only in this component's own state — never sent to the server,
// never touches floor_plan_booths — so exiting always leaves the real
// floor plan exactly as it was; the only way anything survives past the
// session is the operator explicitly clicking "Save as PDF".
export default function FloorPlanPresentation({ hallName, imageUrl, booths, onClose, onPrevHall, onNextHall }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const svgRef = useRef(null);
  const scrollRef = useRef(null); // the scrollable capture container, for Hand-tool drag-pan + native wheel zoom
  const panRef = useRef(null); // { startX, startY, scrollLeft, scrollTop } while actively dragging with Hand

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [thickness, setThickness] = useState(3); // 1-10
  const [strokes, setStrokes] = useState([]); // { id, tool, color, width, points: [{x,y}] }
  const [currentStroke, setCurrentStroke] = useState(null);
  const [erasing, setErasing] = useState(false);
  const [texts, setTexts] = useState([]); // { id, x, y, text, color, fontSize, bold, italic, underline }
  const [activeTextId, setActiveTextId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  // The image's own laid-out pixel size (unaffected by the zoom transform
  // below) — used to size booth labels and the eraser hit radius in real
  // pixels regardless of the image's resolution.
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // One fixed booth-number size for the whole hall — see FloorPlan.jsx's
  // identical comment on fitUniformBoothNumberSize.
  const uniformNumFs = useMemo(() => {
    if (imgSize.w <= 0) return 9;
    return fitUniformBoothNumberSize(booths.map((b) => ({
      boothNo: b.booth_no,
      boxW: safe((Number(b.width_pct) / 100) * imgSize.w, 40),
      boxH: safe((Number(b.height_pct) / 100) * imgSize.h, 40),
    })));
  }, [booths, imgSize]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const measure = () => setImgSize({ w: el.offsetWidth || 0, h: el.offsetHeight || 0 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imageUrl]);

  // Annotations are per-hall — without this, switching hall via Prev/Next
  // would leave the old hall's strokes/text drawn over the new image.
  useEffect(() => {
    setStrokes([]);
    setTexts([]);
    setActiveTextId(null);
    setCurrentStroke(null);
  }, [imageUrl]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen?.();
      }
    } catch {
      // Denied or unsupported here — the fixed overlay still works fine.
    }
  }

  function zoomIn() { setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100)); }
  function zoomOut() { setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100)); }
  function zoomReset() { setZoom(1); }

  // React's onWheel prop is registered passive in most browsers, so
  // e.preventDefault() inside it silently fails to stop Ctrl+scroll —
  // Chrome/Edge/Windows then fall through to the OS/browser's own page-zoom
  // gesture, zooming the whole tab instead of just the floor plan. Only a
  // real native listener added with { passive: false } can actually
  // intercept it, so this bypasses React's synthetic event system entirely.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Hand tool: plain click-drag panning, since the SVG has pointerEvents
  // switched off for this tool (letting these fire on the scroll container
  // underneath instead of being mistaken for a drawing gesture).
  function handlePanDown(e) {
    if (tool !== 'hand') return;
    const el = scrollRef.current;
    panRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  }
  function handlePanMove(e) {
    if (!panRef.current) return;
    const el = scrollRef.current;
    el.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.startX);
    el.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.startY);
  }
  function handlePanUp() {
    panRef.current = null;
  }

  function pctFromEvent(e) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }

  // Eraser removes whole strokes AND text boxes it touches — simpler and
  // more reliable than true pixel-level partial erasing, and matches how
  // lightweight annotation tools (Adobe Reader's included) behave for
  // freehand markup.
  function eraseAt(p) {
    const radiusPct = imgSize.w > 0 ? safe(((thickness * 5) / imgSize.w) * 100, 2) : 2;
    const hits = (x, y) => Math.hypot(x - p.x, y - p.y) < radiusPct;
    setStrokes((prev) => prev.filter((s) => !s.points.some((pt) => hits(pt.x, pt.y))));
    const erasedActive = texts.some((t) => t.id === activeTextId && hits(t.x, t.y));
    if (erasedActive) setActiveTextId(null);
    setTexts((prev) => prev.filter((t) => !hits(t.x, t.y)));
  }

  function handlePointerDown(e) {
    if (tool === 'hand' || tool === 'text') return;
    e.preventDefault();
    const p = pctFromEvent(e);
    if (tool === 'eraser') {
      setErasing(true);
      eraseAt(p);
    } else {
      setCurrentStroke({ tool, color, width: thickness, points: [p] });
    }
  }
  function handlePointerMove(e) {
    if (tool === 'hand' || tool === 'text') return;
    if (tool === 'eraser') {
      if (erasing) eraseAt(pctFromEvent(e));
      return;
    }
    if (!currentStroke) return;
    const p = pctFromEvent(e);
    setCurrentStroke((s) => {
      if (!s) return s;
      const last = s.points[s.points.length - 1];
      // Skip near-duplicate points — keeps stroke data (and re-renders
      // while drawing) reasonable on a long, slow drag.
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.25) return s;
      return { ...s, points: [...s.points, p] };
    });
  }
  function handlePointerUp() {
    if (tool === 'eraser') { setErasing(false); return; }
    setCurrentStroke((s) => {
      if (s && s.points.length > 1) setStrokes((prev) => [...prev, { ...s, id: uid() }]);
      return null;
    });
  }

  function handleSvgClick(e) {
    if (tool !== 'text') return;
    const p = pctFromEvent(e);
    const id = uid();
    setTexts((t) => [...t, { id, x: p.x, y: p.y, text: '', color, fontSize: 16, bold: false, italic: false, underline: false }]);
    setActiveTextId(id);
  }

  function updateActiveText(fields) {
    setTexts((t) => t.map((x) => (x.id === activeTextId ? { ...x, ...fields } : x)));
  }
  function deleteActiveText() {
    setTexts((t) => t.filter((x) => x.id !== activeTextId));
    setActiveTextId(null);
  }
  // An empty text box left behind (clicked, never typed into) is just
  // clutter — quietly removed rather than saved as a blank label.
  function handleTextBlur(id, e) {
    const value = e.target.textContent.trim();
    if (!value) {
      setTexts((t) => t.filter((x) => x.id !== id));
      if (activeTextId === id) setActiveTextId(null);
    } else {
      setTexts((t) => t.map((x) => (x.id === id ? { ...x, text: value } : x)));
    }
  }

  function handleUndo() {
    setStrokes((s) => s.slice(0, -1));
  }
  function handleClear() {
    if (strokes.length === 0 && texts.length === 0) return;
    if (!window.confirm('Clear all drawing and text on this view? This only affects this presentation session.')) return;
    setStrokes([]);
    setTexts([]);
    setActiveTextId(null);
  }

  async function handleSavePdf() {
    setActiveTextId(null); // no editing caret/outline in the exported file
    setSaving(true);
    const priorZoom = zoom;
    try {
      // Capture at zoom=100% regardless of what the user was viewing at —
      // the capture target itself carries the zoom transform (see below),
      // so exporting mid-zoom would otherwise scale the raster oddly and
      // vary the export size run to run. Wait a tick for the reflow to
      // actually paint before html2canvas reads the DOM.
      if (priorZoom !== 1) {
        setZoom(1);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      // Hi-res + a page sized to match the map's own aspect ratio (not a
      // fixed A1 rectangle, which left the map stranded in a corner with
      // empty margin whenever the hall's own proportions didn't match A1)
      // so the exported floor plan fills the sheet and can be zoomed into
      // for audit purposes without the booth labels turning to mush.
      //
      // The page format is computed HERE, upfront, from imgSize (already
      // reliably tracked via the map image's own onLoad/ResizeObserver) —
      // not via html2pdf's post-capture recompute-and-reset-pageSize path (a
      // longEdge option once threaded through to pdf.js): that path
      // re-derives the page format from the captured canvas AFTER
      // toContainer() has already run once using whatever pageSize was
      // cached from the Worker's construction-time default ('a4'), sizing
      // the actual html2canvas capture container to A4's width regardless
      // of what the recomputed format said afterwards — which is what was
      // leaving the real map rendered small in a corner of an unrelated
      // page shape. Passing the correct format from the very first call
      // sidesteps that caching order entirely — see FloorPlan.jsx's
      // matching export.
      // A0 at scale 4 only rasterized at ~89 DPI — a PDF viewer's "zoom in"
      // just magnifies whatever pixels are actually embedded, so a huge
      // physical page with a modest pixel count is what was making zoomed-in
      // text/labels look soft, not the mm page size itself. A1's long edge
      // with a much higher scale roughly triples the embedded pixel count
      // (and lands at ~250 DPI, sharp for physical printing too) without an
      // unreasonably large canvas.
      const aspect = imgSize.w > 0 && imgSize.h > 0 ? imgSize.w / imgSize.h : 1;
      const longEdgeMm = 841;
      const format = aspect >= 1 ? [longEdgeMm, longEdgeMm / aspect] : [longEdgeMm * aspect, longEdgeMm];
      await downloadPdf(
        'floor-plan-presentation-capture', `${hallName}-presentation-${new Date().toISOString().slice(0, 10)}`, 'landscape',
        { scale: 8, format, margin: 0, width: imgSize.w, height: imgSize.h }
      );
    } finally {
      if (priorZoom !== 1) setZoom(priorZoom);
      setSaving(false);
    }
  }

  async function handleExit() {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* already exiting */ }
    }
    onClose();
  }

  const pointsAttr = (pts) => pts.map((p) => `${safe(p.x, 0)},${safe(p.y, 0)}`).join(' ');
  const strokeWidthFor = (t, w) => (t === 'highlighter' ? w * 1.8 : w) * 0.35; // scaled into 0-100 viewBox units
  const activeText = texts.find((t) => t.id === activeTextId);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#fff', display: 'flex', flexDirection: 'column' }}
    >
      <div className="no-print" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
        background: '#1B3A6B', color: '#fff', flexWrap: 'wrap', rowGap: 6,
      }}>
        {onPrevHall && <button type="button" onClick={onPrevHall} title="Previous hall">‹ Prev Hall</button>}
        <strong style={{ marginRight: 8 }}>{hallName} — Presentation Mode</strong>
        {onNextHall && <button type="button" onClick={onNextHall} title="Next hall">Next Hall ›</button>}

        <span style={{ display: 'inline-flex', gap: 4 }}>
          {TOOLS.map((t) => (
            <button
              key={t.key} type="button" title={t.label} onClick={() => setTool(t.key)}
              style={{ background: tool === t.key ? '#F47920' : '#2a4d80', border: 'none', fontSize: 15, padding: '5px 8px' }}
            >
              {t.icon}
            </button>
          ))}
        </span>

        <span style={{ display: 'inline-flex', gap: 4 }}>
          {COLORS.map((c) => (
            <button
              key={c} type="button" onClick={() => setColor(c)} title={c}
              style={{ width: 20, height: 20, borderRadius: '50%', background: c, padding: 0, border: color === c ? '3px solid #fff' : '1px solid rgba(255,255,255,0.5)' }}
            />
          ))}
        </span>

        {(tool === 'pen' || tool === 'highlighter' || tool === 'eraser') && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            Size
            <input type="range" min="1" max="10" value={thickness} onChange={(e) => setThickness(Number(e.target.value))} style={{ width: 70 }} />
          </span>
        )}

        <button type="button" onClick={handleUndo} disabled={strokes.length === 0}>Undo Stroke</button>
        <button type="button" onClick={handleClear} disabled={strokes.length === 0 && texts.length === 0}>Clear All</button>

        {activeText && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#0f2d5c', padding: '4px 8px', borderRadius: 6 }}>
            <button type="button" onClick={() => updateActiveText({ bold: !activeText.bold })} style={{ fontWeight: 700, background: activeText.bold ? '#F47920' : '#2a4d80' }}>B</button>
            <button type="button" onClick={() => updateActiveText({ italic: !activeText.italic })} style={{ fontStyle: 'italic', background: activeText.italic ? '#F47920' : '#2a4d80' }}>I</button>
            <button type="button" onClick={() => updateActiveText({ underline: !activeText.underline })} style={{ textDecoration: 'underline', background: activeText.underline ? '#F47920' : '#2a4d80' }}>U</button>
            <button type="button" onClick={() => updateActiveText({ fontSize: Math.max(8, activeText.fontSize - 2) })}>A−</button>
            <span style={{ fontSize: 12, minWidth: 20, textAlign: 'center' }}>{activeText.fontSize}</span>
            <button type="button" onClick={() => updateActiveText({ fontSize: Math.min(48, activeText.fontSize + 2) })}>A+</button>
            <button type="button" onClick={deleteActiveText} style={{ background: '#c83c3c' }}>Delete Text</button>
          </span>
        )}

        <span style={{ width: 8 }} />
        <button type="button" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
        <span style={{ fontSize: 12, minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
        <button type="button" onClick={zoomReset} disabled={zoom === 1}>Reset</button>
        <button type="button" onClick={toggleFullscreen}>⛶ Full Screen</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={handleSavePdf} disabled={saving}>{saving ? 'Saving...' : 'Save as PDF'}</button>
        <button type="button" onClick={handleExit} style={{ background: '#F47920' }}>Exit Presentation</button>
      </div>

      <div
        ref={scrollRef}
        onPointerDown={handlePanDown}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanUp}
        onPointerLeave={handlePanUp}
        style={{ flex: 1, position: 'relative', overflow: 'auto', background: '#f5f6fa', cursor: tool === 'hand' ? (panRef.current ? 'grabbing' : 'grab') : 'default' }}
      >
        <div style={{ position: 'relative', minWidth: '100%', minHeight: '100%', display: 'flex' }}>
          {/* Sized to the POST-zoom pixel dimensions, not just wrapped in
              transform: scale — a scroll container computes its own
              scrollable range from real layout size, and a transformed
              child with no explicit size of its own left the browser
              guessing (see FloorPlan.jsx's matching comment). Without
              transformOrigin: '0 0' on the capture div below, the default
              center-origin scale also grew the content up/left as well as
              down/right — but scrolling can never reach negative
              coordinates, so anything that grew past the original box's
              top/left edge was permanently unreachable. Both together are
              what was leaving the top and left of a zoomed-in map
              inaccessible while the bottom/right panned fine.
              Centering via margin: auto (below), not the flex parent's
              alignItems/justifyContent: center — flexbox centering an item
              that outgrows its container (which happens as soon as zoom
              pushes the spacer past the viewport) splits the overflow
              evenly on both sides, and the leading/top-left half of that
              split lands in the same unreachable negative-scroll territory
              as above, while the trailing/right half renders past where
              the visible map content actually ends — which is what was
              making booths on the right (and bottom) appear to float
              disconnected from the image once zoomed past 100%. margin:
              auto on the child centers it only while it's smaller than the
              container and falls back to normal, fully-reachable scrolling
              the moment it's bigger — the same reason this is the standard
              fix for "centered flex item with overflow". */}
          <div style={{ margin: 'auto', width: imgSize.w ? imgSize.w * zoom : undefined, height: imgSize.h ? imgSize.h * zoom : undefined }}>
          {/* transform lives on its OWN wrapper, sized to fit-content — not
              on the capture div itself. A plain block element with no
              declared width stretches to 100% of its containing block (the
              zoomed spacer above), so if the transform and the capture div
              were the same element, its own box would already be
              imgSize.w * zoom wide BEFORE the CSS transform ran, and
              transform: scale(zoom) would then scale that already-zoomed
              box again — a zoom^2 growth for the box (and everything
              percentage-positioned against it, i.e. every booth) while the
              <img> itself (fixed intrinsic size, unaffected by the block
              stretch) only ever grows by zoom^1. That mismatch is exactly
              what showed up as booths drifting right/down further the
              higher the zoom went. width: 'fit-content' here keeps this
              wrapper sized to its own (unscaled) content no matter how wide
              its parent is, so scale(zoom) is the only place zoom is ever
              applied — matching FloorPlan.jsx's (bug-free) normal-view
              structure, which already keeps its transform wrapper and
              capture div separate for the same reason. */}
          <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', width: 'fit-content' }}>
          {/* This inner div — not the outer scrollable viewport — is what
              gets captured for PDF export, so the raster is tightly cropped
              to the actual map content instead of the whole (much larger,
              mostly empty) scroll container. display: inline-block for the
              same reason as the wrapper above — must not stretch to its
              parent's width, since the booth/text/SVG overlays are all
              percentage-positioned against THIS box. */}
          <div id="floor-plan-presentation-capture" style={{ position: 'relative', display: 'inline-block' }}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt={hallName}
              style={{ display: 'block', maxWidth: '85vw', maxHeight: 'calc(100vh - 80px)', width: 'auto', height: 'auto' }}
              draggable={false}
              onLoad={(e) => setImgSize({ w: e.target.offsetWidth || 0, h: e.target.offsetHeight || 0 })}
            />
            {booths.map((b) => {
              const name = (b.opportunity_id || b.sales_order_id) ? (b.fascia_name || b.exhibitor_display_name || '') : '';
              const boxW = safe((Number(b.width_pct) / 100) * imgSize.w, 40);
              const boxH = safe((Number(b.height_pct) / 100) * imgSize.h, boxW);
              const numFs = uniformNumFs;
              const nameAvailH = Math.max(0, boxH - numFs * 1.15 - 3);
              const nameFs = safe(fitBoothName(name, boxW, nameAvailH), 6);
              const displayName = truncateBoothName(name, nameFs, boxW, nameAvailH);
              return (
                <div
                  key={b.id}
                  style={{
                    position: 'absolute',
                    left: `${b.x_pct}%`, top: `${b.y_pct}%`, width: `${b.width_pct}%`, height: `${b.height_pct}%`,
                    background: STATUS_COLORS[b.computed_status] || STATUS_COLORS.AVAILABLE,
                    border: `1px solid ${STATUS_BORDER[b.computed_status] || STATUS_BORDER.AVAILABLE}`,
                    boxSizing: 'border-box', overflow: 'hidden',
                    // flex-start pins the booth number to the top of every
                    // box — see FloorPlan.jsx's identical change for why.
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
                    textAlign: 'center', pointerEvents: 'none', lineHeight: 1.05, color: '#1B3A6B',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: numFs }}>{b.booth_no}</div>
                  {displayName && <div style={{ fontSize: nameFs, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', maxWidth: '100%' }}>{displayName}</div>}
                </div>
              );
            })}

            {/* Drawing layer — its own 0-100 coordinate space stretched
                exactly over the image, so strokes stay aligned with the
                booths beneath regardless of image resolution or zoom.
                pointerEvents is switched off entirely for the Hand tool so
                normal scroll/trackpad panning takes over untouched. */}
            <svg
              ref={svgRef}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                cursor: tool === 'hand' ? 'grab' : tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair',
                touchAction: tool === 'hand' ? 'auto' : 'none',
                pointerEvents: tool === 'hand' ? 'none' : 'auto',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onClick={handleSvgClick}
            >
              {strokes.map((s) => (
                <polyline
                  key={s.id} points={pointsAttr(s.points)} fill="none" stroke={s.color}
                  strokeWidth={strokeWidthFor(s.tool, s.width)} strokeOpacity={s.tool === 'highlighter' ? 0.4 : 1}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              ))}
              {currentStroke && (
                <polyline
                  points={pointsAttr(currentStroke.points)} fill="none" stroke={currentStroke.color}
                  strokeWidth={strokeWidthFor(currentStroke.tool, currentStroke.width)} strokeOpacity={currentStroke.tool === 'highlighter' ? 0.4 : 1}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              )}
            </svg>

            {/* Text layer sits above the SVG (plain DOM, not SVG, so each
                label can be a real editable element) — pointerEvents is
                only enabled on the text tool or an already-placed label,
                so it never blocks drawing with the other tools. */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {texts.map((t) => (
                <div
                  key={t.id}
                  contentEditable={t.id === activeTextId}
                  suppressContentEditableWarning
                  onClick={(e) => { e.stopPropagation(); setActiveTextId(t.id); }}
                  onBlur={(e) => handleTextBlur(t.id, e)}
                  style={{
                    position: 'absolute', left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-2px, -2px)',
                    minWidth: 10, minHeight: '1em', padding: '1px 3px', pointerEvents: 'auto',
                    color: t.color, fontSize: t.fontSize, fontWeight: t.bold ? 700 : 400,
                    fontStyle: t.italic ? 'italic' : 'normal', textDecoration: t.underline ? 'underline' : 'none',
                    outline: t.id === activeTextId ? '1px dashed #1B3A6B' : 'none', whiteSpace: 'pre', cursor: tool === 'text' ? 'text' : 'pointer',
                  }}
                >
                  {t.text}
                </div>
              ))}
            </div>
          </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
