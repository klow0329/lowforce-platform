import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import FloorPlanPresentation from '../components/FloorPlanPresentation';
import ErrorBoundary from '../components/ErrorBoundary';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const section = { marginBottom: 32 };

const emptyBoothForm = {
  id: null, booth_no: '', x_pct: '', y_pct: '', width_pct: '', height_pct: '', sqm: '',
  is_corner: false, is_loading: false, status: 'AVAILABLE',
  opportunity_id: null, sales_order_id: null, exhibitor_display_name: '', fascia_name: '', notes: '',
};

const emptyGridForm = {
  start_no: '', rows: 1, cols: 1, start_x_pct: '', start_y_pct: '',
  cell_width_pct: '', cell_height_pct: '', gap_x_pct: 0, gap_y_pct: 0, sqm: '', is_loading_edge_col: false,
};

// PROPOSED = linked to an Opportunity (not yet a signed, approved deal);
// SOLD = linked to a Contract that's fully approved (ready to invoice).
// Both are computed by the backend from the opportunity_id/sales_order_id
// link, never set by hand here — see computed_status in listBooths.
// RESERVED is the one status Operations does set directly: a booth held
// back from the available pool without being tied to any deal yet.
// Near-opaque fills on purpose: the hall drawing usually has its own booth
// number printed underneath, and a translucent overlay made every number
// appear twice. Covering it means exactly one label — ours — per booth.
const STATUS_COLORS = {
  AVAILABLE: 'rgba(214, 235, 219, 0.95)',
  RESERVED: 'rgba(211, 214, 242, 0.95)',
  PROPOSED: 'rgba(247, 228, 187, 0.95)',
  SOLD: 'rgba(243, 209, 209, 0.95)',
};
const STATUS_BORDER = { AVAILABLE: '#1E7B34', RESERVED: '#4a4fb0', PROPOSED: '#8a6d1a', SOLD: '#c83c3c' };
const STATUS_LABELS = { AVAILABLE: 'Available', RESERVED: 'Reserved', PROPOSED: 'Proposed', SOLD: 'Sold' };

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

// Not a drag/drop canvas by design — Operations already edits the master
// layout in Illustrator and exports a high-res PDF/image; this table-driven
// configurator just needs to mirror booth number/position/status so the
// rest of the system (and other departments) can use it. Booth position is
// stored as a % of the image's own width/height, so it renders correctly
// at any image resolution with no separate calibration step.
export default function FloorPlan({ user }) {
  const { selectedEventId } = useEventContext();
  // Management can view/pick booths and print, same as everyone, but not
  // create/edit/delete them — that stays Admin/Operations only.
  const isElevated = ['ADM', 'OPS'].includes(user?.role_code);
  const location = useLocation();
  const navigate = useNavigate();
  const pickFor = location.state?.pickFor;

  const [halls, setHalls] = useState([]);
  const [hallId, setHallId] = useState('');
  const [newHallName, setNewHallName] = useState('');
  const [uploading, setUploading] = useState(false);

  const [booths, setBooths] = useState([]);
  const [boothForm, setBoothForm] = useState(emptyBoothForm);
  const [showBoothForm, setShowBoothForm] = useState(false);
  const [copyFromNo, setCopyFromNo] = useState('');
  const [splitCount, setSplitCount] = useState({});
  const [gridForm, setGridForm] = useState(emptyGridForm);
  const [showGridForm, setShowGridForm] = useState(false);
  const [error, setError] = useState('');
  const [imgVersion, setImgVersion] = useState(0);
  const [imgHeightPx, setImgHeightPx] = useState(0); // for fitting booth label fonts to box height
  const [presenting, setPresenting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [highlightedBoothId, setHighlightedBoothId] = useState(null);
  // Undo/redo for booth edits (5 steps each way). Each entry stores the
  // editable fields before and after one saved change — geometry only, never
  // opportunity/contract links (undoing those would trigger the release
  // cascade and silently strip a deal's booth).
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const imgWrapRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null); // { mode: 'move'|'resize', startXPct, startYPct, startWPct, startHPct, startClientX, startClientY }
  const highlightTimerRef = useRef(null);

  function loadHalls() {
    if (!selectedEventId) return;
    api.listFloorPlanHalls(selectedEventId).then(({ halls }) => {
      setHalls(halls);
      if (halls.length > 0 && !halls.some((h) => h.id === hallId)) setHallId(halls[0].id);
      if (halls.length === 0) setHallId('');
    });
  }

  function loadBooths() {
    if (!hallId) { setBooths([]); return; }
    api.listFloorPlanBooths(hallId).then(({ booths }) => setBooths(booths));
  }

  useEffect(loadHalls, [selectedEventId]);
  useEffect(loadBooths, [hallId]);
  // History is per-hall — switching halls clears it so an undo can never
  // land on a booth in a different hall.
  useEffect(() => { setUndoStack([]); setRedoStack([]); }, [hallId]);

  const selectedHall = halls.find((h) => h.id === hallId);

  async function handleAddHall(e) {
    e.preventDefault();
    setError('');
    try {
      const { hall } = await api.createFloorPlanHall({ event_id: selectedEventId, name: newHallName });
      setNewHallName('');
      loadHalls();
      setHallId(hall.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteHall() {
    if (!window.confirm(`Delete "${selectedHall.name}" and all its booths? This can't be undone.`)) return;
    setError('');
    try {
      await api.deleteFloorPlanHall(hallId);
      setHallId('');
      loadHalls();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUploadImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const { convertedFromPdf } = await api.uploadFloorPlanHallImage(hallId, file);
      setImgVersion((v) => v + 1);
      loadHalls();
      if (convertedFromPdf) {
        window.alert('PDF converted to an image for display. Click "Auto-detect Booths" below to pull booth numbers and rough positions from it.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleAutoDetect() {
    if (!window.confirm('Scan this hall\'s PDF for booth numbers and create a first-pass booth list? Existing booth numbers are left untouched.')) return;
    setError('');
    try {
      const { created, found } = await api.autoDetectFloorPlanBooths(hallId);
      loadBooths();
      window.alert(`Found ${found} candidate booth number(s), created ${created} new booth(s)${found > created ? ` (${found - created} already existed)` : ''}. Review sizes/positions below — the auto-detect gives a starting size, not exact geometry.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function startEditBooth(b) {
    setBoothForm({
      id: b.id, booth_no: b.booth_no, x_pct: b.x_pct, y_pct: b.y_pct,
      width_pct: b.width_pct, height_pct: b.height_pct, sqm: b.sqm ?? '',
      is_corner: b.is_corner, is_loading: b.is_loading, status: b.status,
      opportunity_id: b.opportunity_id, sales_order_id: b.sales_order_id,
      exhibitor_display_name: b.exhibitor_display_name || '', fascia_name: b.fascia_name || '', notes: b.notes || '',
    });
    setShowBoothForm(true);
  }

  // Assignment is derived from whichever Opportunity/Contract holds this
  // booth — never typed here — to avoid the two sides ever disagreeing. This
  // is the one place to break that link directly from the Floor Plan side;
  // it also clears the Hall/Booth No/Dimension on that Opportunity/Contract
  // (cascadeReleaseIfNeeded on the backend), same as deleting the booth does.
  async function handleRemoveAssignment() {
    if (!window.confirm(`Remove the exhibitor assignment from booth ${boothForm.booth_no}? It becomes available again, and the linked Opportunity/Contract's booth fields will be cleared too.`)) return;
    setError('');
    try {
      await api.updateFloorPlanBooth(hallId, boothForm.id, { opportunity_id: null, sales_order_id: null });
      setBoothForm(emptyBoothForm);
      setShowBoothForm(false);
      loadBooths();
    } catch (err) {
      setError(err.message);
    }
  }

  function zoomIn() { setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100)); }
  function zoomOut() { setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100)); }
  function zoomReset() { setZoom(1); }

  // Ctrl+scroll zooms the map only (not the whole page) — a plain scroll
  // still pans the map's own scroll container normally. This has to be a
  // real native listener, not React's onWheel prop: React registers wheel
  // handlers as passive in most browsers, so e.preventDefault() inside a
  // synthetic onWheel silently does nothing, and Ctrl+scroll falls through
  // to the browser/OS's own page-zoom gesture instead — zooming the whole
  // tab rather than just the map. Only { passive: false } on a genuine
  // addEventListener can actually stop that.
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
  }, [selectedHall?.background_filename]);

  // Jumps to a booth from the list below — the map can have 100+ small
  // booths, so a freshly-created one is easy to lose track of otherwise.
  function handleLocateBooth(b) {
    const el = document.getElementById(`floor-plan-booth-${b.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    setHighlightedBoothId(b.id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedBoothId(null), 2500);
  }

  // A brand-new booth needs a starting box to actually see and drag —
  // placed roughly centred so it's visible on any hall image.
  function startAddBooth() {
    setBoothForm({ ...emptyBoothForm, x_pct: 40, y_pct: 40, width_pct: 4, height_pct: 4 });
    setShowBoothForm(true);
  }

  function applyCopySize() {
    const source = booths.find((b) => b.booth_no === copyFromNo.trim());
    if (!source) { setError(`No booth numbered "${copyFromNo}" found in this hall.`); return; }
    setError('');
    setBoothForm((f) => ({ ...f, width_pct: source.width_pct, height_pct: source.height_pct, sqm: source.sqm ?? f.sqm }));
  }

  // Splits one existing booth's width into N equal, individually-numbered
  // booths side by side — the direct fix for a merged block like the real
  // plan's 1501-1511 (currently one big booth where the neighbouring column
  // has 12 individual ones): pick the merged booth, split it, then rename/
  // fine-tune the results instead of typing 12 rows from scratch.
  async function handleSplitBooth(b) {
    const n = Number(splitCount[b.id]) || 2;
    if (n < 2) return;
    if (!window.confirm(`Split booth ${b.booth_no} into ${n} equal booths side by side? The original booth will be replaced.`)) return;
    setError('');
    try {
      const newWidth = Number(b.width_pct) / n;
      const newSqm = b.sqm ? Number(b.sqm) / n : null;
      for (let i = 0; i < n; i++) {
        const suffix = String.fromCharCode(65 + i); // A, B, C...
        await api.createFloorPlanBooth(hallId, {
          booth_no: `${b.booth_no}${suffix}`,
          x_pct: Number(b.x_pct) + i * newWidth,
          y_pct: b.y_pct,
          width_pct: newWidth,
          height_pct: b.height_pct,
          sqm: newSqm,
          is_corner: i === 0 || i === n - 1 ? b.is_corner : false,
          is_loading: b.is_loading,
        });
      }
      await api.deleteFloorPlanBooth(hallId, b.id);
      loadBooths();
    } catch (err) {
      setError(err.message);
    }
  }

  // Drag-to-move / drag-to-resize the booth currently open in the form,
  // directly on the image — a much more approachable way to place a booth
  // than typing raw x/y/width/height percentages by hand.
  function pctFromEvent(e) {
    const rect = imgWrapRef.current.getBoundingClientRect();
    return { xPct: ((e.clientX - rect.left) / rect.width) * 100, yPct: ((e.clientY - rect.top) / rect.height) * 100 };
  }

  function handleDragStart(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode,
      startPointer: pctFromEvent(e),
      startBox: {
        x_pct: Number(boothForm.x_pct) || 0, y_pct: Number(boothForm.y_pct) || 0,
        width_pct: Number(boothForm.width_pct) || 1, height_pct: Number(boothForm.height_pct) || 1,
      },
    };
  }

  // The move/resize listeners are attached once for the component's whole
  // lifetime (not per drag) — attaching/removing them per mousedown/mouseup
  // is fragile here because handleDragStart/End would need stable function
  // identities across renders to correctly remove what was added, and plain
  // functions redeclared every render don't have that, so a per-drag
  // add/remove would leak a listener every time. Everything these two touch
  // (dragRef, imgWrapRef, setBoothForm) is stable, so a no-op guard when
  // nothing is being dragged is all that's needed.
  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return;
      const { mode, startPointer, startBox } = dragRef.current;
      const now = pctFromEvent(e);
      const dx = now.xPct - startPointer.xPct;
      const dy = now.yPct - startPointer.yPct;
      if (mode === 'move') {
        setBoothForm((f) => ({
          ...f,
          x_pct: Math.round((startBox.x_pct + dx) * 100) / 100,
          y_pct: Math.round((startBox.y_pct + dy) * 100) / 100,
        }));
      } else {
        setBoothForm((f) => ({
          ...f,
          width_pct: Math.max(0.2, Math.round((startBox.width_pct + dx) * 100) / 100),
          height_pct: Math.max(0.2, Math.round((startBox.height_pct + dy) * 100) / 100),
        }));
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function handleBoothClick(b) {
    if (pickFor) handlePickBooth(b);
    else if (isElevated) startEditBooth(b);
    else if (b.assigned_salesperson_id && b.assigned_salesperson_id === user?.id) handleEditFascia(b);
  }

  // Salespeople can rename the Fascia Board of their own assigned booth —
  // and nothing else on the Floor Plan (also enforced server-side).
  async function handleEditFascia(b) {
    const name = window.prompt(
      `Fascia Board Name for booth ${b.booth_no} (leave blank to use the exhibitor name):`,
      b.fascia_name || ''
    );
    if (name === null) return;
    setError('');
    try {
      await api.updateFloorPlanBooth(hallId, b.id, { fascia_name: name.trim() });
      loadBooths();
    } catch (err) {
      setError(err.message);
    }
  }

  // Hands the picked booth's info back to whichever screen sent the user
  // here — Opportunity or Contract — WITHOUT touching the booth itself.
  // Real-world testing found that locking it right here, before the
  // Opportunity/Contract is actually saved, orphans the booth if the user
  // picks one and then abandons the form without saving: the booth stays
  // "taken" forever with nothing real behind it. The booth only actually
  // locks once that record's own save succeeds (see the floor_plan_booth_id
  // handling in createOpportunity/updateOpportunity/updateSalesOrder) —
  // this screen just previews current availability as a courtesy; the save
  // itself re-checks it's still free.
  function handlePickBooth(b) {
    if (b.computed_status !== 'AVAILABLE') {
      window.alert(`Booth ${b.booth_no} is already ${b.computed_status === 'SOLD' ? 'taken' : b.computed_status.toLowerCase()}.`);
      return;
    }
    if (!window.confirm(`Use booth ${b.booth_no}${b.sqm ? ` (${b.sqm} sqm)` : ''} for ${pickFor.exhibitorName}? This won't lock it until you click Save on the ${pickFor.boothStatus === 'SOLD' ? 'contract' : 'opportunity'}.`)) return;
    navigate(pickFor.returnPath, {
      state: {
        pickedBooth: {
          id: b.id, hall: selectedHall.name, booth_no: b.booth_no,
          dimension: b.sqm ? `${b.sqm} sqm` : '',
          sqm: b.sqm, is_corner: b.is_corner, is_loading: b.is_loading,
        },
        formSnapshot: pickFor.formSnapshot,
      },
    });
  }

  // The fields undo/redo restores — matches what the booth form edits, minus
  // the deal links (see the undoStack comment above).
  const UNDO_FIELDS = ['booth_no', 'x_pct', 'y_pct', 'width_pct', 'height_pct', 'sqm', 'is_corner', 'is_loading', 'fascia_name', 'notes'];
  const pickUndoFields = (src) => Object.fromEntries(UNDO_FIELDS.map((f) => [f, src[f] ?? null]));

  async function handleSaveBooth(e) {
    e.preventDefault();
    setError('');
    const { id, ...payload } = boothForm;
    if (!window.confirm(id ? `Save changes to booth ${boothForm.booth_no}?` : `Add booth ${boothForm.booth_no}?`)) return;
    try {
      if (id) {
        const prev = booths.find((b) => b.id === id);
        await api.updateFloorPlanBooth(hallId, id, payload);
        if (prev) {
          setUndoStack((s) => [...s, { boothId: id, boothNo: prev.booth_no, before: pickUndoFields(prev), after: pickUndoFields(payload) }].slice(-5));
          setRedoStack([]);
        }
      } else {
        await api.createFloorPlanBooth(hallId, payload);
      }
      setBoothForm(emptyBoothForm);
      setShowBoothForm(false);
      loadBooths();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUndo() {
    const action = undoStack[undoStack.length - 1];
    if (!action) return;
    setError('');
    try {
      await api.updateFloorPlanBooth(hallId, action.boothId, action.before);
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, action].slice(-5));
      loadBooths();
    } catch (err) {
      setError(`Undo failed: ${err.message}`);
    }
  }

  async function handleRedo() {
    const action = redoStack[redoStack.length - 1];
    if (!action) return;
    setError('');
    try {
      await api.updateFloorPlanBooth(hallId, action.boothId, action.after);
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, action].slice(-5));
      loadBooths();
    } catch (err) {
      setError(`Redo failed: ${err.message}`);
    }
  }

  async function handleDeleteBooth(b) {
    if (!window.confirm(`Delete booth ${b.booth_no}?`)) return;
    setError('');
    try {
      await api.deleteFloorPlanBooth(hallId, b.id);
      loadBooths();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleGenerateGrid(e) {
    e.preventDefault();
    setError('');
    const count = Number(gridForm.rows) * Number(gridForm.cols);
    if (!window.confirm(`Generate ${count} booths (${gridForm.start_no}...) on this grid?`)) return;
    try {
      const { created } = await api.bulkGenerateFloorPlanBooths(hallId, gridForm);
      setShowGridForm(false);
      loadBooths();
      window.alert(`${created} booth(s) created${created < count ? ` (${count - created} skipped — booth number already existed)` : ''}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (presenting && selectedHall) {
    return (
      <ErrorBoundary label="Presentation Mode" onReset={() => setPresenting(false)}>
        <FloorPlanPresentation
          hallName={selectedHall.name}
          imageUrl={`${api.floorPlanHallImageUrl(hallId)}?v=${imgVersion}`}
          booths={booths}
          onClose={() => setPresenting(false)}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '40px auto' }}>
      <h2>Floor Plan</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {pickFor && (
        <div style={{ background: '#E3F2FD', border: '1px solid #90CAF9', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Picking a booth for <strong>{pickFor.exhibitorName}</strong> — click an available (green) booth on the plan below.</span>
          <button type="button" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      )}

      <div style={section}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Hall:</label>
          <select value={hallId} onChange={(e) => setHallId(e.target.value)} style={{ padding: 8 }}>
            {halls.length === 0 && <option value="">No halls yet</option>}
            {halls.map((h) => (
              <option key={h.id} value={h.id}>{h.name} ({h.booth_count} booths, {h.occupied_count} occupied)</option>
            ))}
          </select>
          {isElevated && (
            <>
              {hallId && <button type="button" onClick={handleDeleteHall}>Delete Hall</button>}
              <form onSubmit={handleAddHall} style={{ display: 'flex', gap: 6 }}>
                <input placeholder="New hall name, e.g. Hall 1 & 2" style={{ padding: 8, width: 220 }} value={newHallName} onChange={(e) => setNewHallName(e.target.value)} required />
                <button type="submit">+ Add Hall</button>
              </form>
            </>
          )}
        </div>
      </div>

      {hallId && (
        <>
          {isElevated && (
            <div style={section}>
              <label style={label}>Background (the real scanned floor plan for this hall — image, or a PDF export from Illustrator)</label>
              <input type="file" accept="image/*,application/pdf" onChange={handleUploadImage} disabled={uploading} />
              {selectedHall?.source_pdf_filename && (
                <button type="button" onClick={handleAutoDetect} style={{ marginTop: 8 }}>
                  Auto-detect Booths from PDF
                </button>
              )}
              <p style={{ fontSize: 12, color: '#5c6070', marginTop: 4 }}>
                Illustrator (.ai) files aren't supported directly — export as PDF or PNG first (the same file you
                already print for reference). A PDF upload also lets you auto-detect booth numbers below.
              </p>
            </div>
          )}

          {selectedHall?.background_filename ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <button type="button" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
                <span style={{ fontSize: 13, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
                <button type="button" onClick={zoomReset} disabled={zoom === 1}>Reset Zoom</button>
                <button type="button" onClick={() => setPresenting(true)} title="Full-screen, read-only view for meetings — draw on it freely, save as PDF, exits without changing anything">
                  🖥 Presentation Mode
                </button>
                <span style={{ fontSize: 12, color: '#5c6070' }}>Ctrl+scroll on the map to zoom too</span>
                {isElevated && (
                  <span style={{ display: 'inline-flex', gap: 6, marginLeft: 12 }}>
                    <button
                      type="button" onClick={handleUndo} disabled={undoStack.length === 0}
                      title={undoStack.length ? `Undo change to booth ${undoStack[undoStack.length - 1].boothNo}` : 'Nothing to undo'}
                    >
                      ↶ Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
                    </button>
                    <button
                      type="button" onClick={handleRedo} disabled={redoStack.length === 0}
                      title={redoStack.length ? `Redo change to booth ${redoStack[redoStack.length - 1].boothNo}` : 'Nothing to redo'}
                    >
                      ↷ Redo{redoStack.length > 0 ? ` (${redoStack.length})` : ''}
                    </button>
                  </span>
                )}
              </div>
              <div
                ref={scrollRef}
                style={{ overflow: 'auto', maxHeight: '70vh', marginBottom: 24, border: '1px solid #ddd' }}
              >
                <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', width: 'fit-content' }}>
                  <div ref={imgWrapRef} style={{ position: 'relative', display: 'inline-block' }}>
                    <img
                      key={imgVersion}
                      src={`${api.floorPlanHallImageUrl(hallId)}?v=${imgVersion}`}
                      alt={selectedHall.name}
                      style={{ display: 'block', width: 1040, maxWidth: 'none', height: 'auto' }}
                      draggable={false}
                      onLoad={(e) => setImgHeightPx(e.target.offsetHeight)}
                    />
                    {booths.map((b) => {
                      if (showBoothForm && boothForm.id === b.id) return null;
                      // Fit the label fully inside the booth box: size the
                      // font from the box's own pixel width and height (the
                      // whole map scales together on zoom, so the fit holds
                      // at every zoom level).
                      const boxW = (Number(b.width_pct) / 100) * 1040;
                      const boxH = imgHeightPx > 0 ? (Number(b.height_pct) / 100) * imgHeightPx : boxW;
                      const name = (b.opportunity_id || b.sales_order_id) ? (b.fascia_name || b.exhibitor_display_name || '') : '';
                      const numLen = Math.max(2, String(b.booth_no || '').length);
                      const numFs = Math.max(4, Math.min(
                        10,
                        (boxW - 4) / (0.62 * numLen),
                        boxH * (name ? 0.4 : 0.6)
                      ));
                      const nameFs = Math.max(3.5, Math.min(numFs * 0.72, (boxW - 4) / (0.55 * Math.max(4, Math.min(name.length, 10)))));
                      return (
                      <div
                        key={b.id}
                        id={`floor-plan-booth-${b.id}`}
                        title={`${b.booth_no}${name ? ` — ${b.fascia_name || b.exhibitor_display_name}` : ''}${b.is_loading ? ' [LOADING]' : ''}${b.is_corner ? ' [CORNER]' : ''}`}
                        onClick={() => handleBoothClick(b)}
                        style={{
                          position: 'absolute',
                          left: `${b.x_pct}%`, top: `${b.y_pct}%`, width: `${b.width_pct}%`, height: `${b.height_pct}%`,
                          background: STATUS_COLORS[b.computed_status] || STATUS_COLORS.AVAILABLE,
                          border: highlightedBoothId === b.id ? '2px solid #ff5500' : `1px solid ${STATUS_BORDER[b.computed_status] || STATUS_BORDER.AVAILABLE}`,
                          boxShadow: highlightedBoothId === b.id ? '0 0 0 4px rgba(255, 85, 0, 0.35)' : 'none',
                          cursor: (isElevated || pickFor || b.assigned_salesperson_id === user?.id) ? 'pointer' : 'default',
                          lineHeight: 1.05, color: '#1B3A6B', overflow: 'hidden', boxSizing: 'border-box',
                          whiteSpace: 'nowrap',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 1,
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: numFs }}>{b.booth_no}</div>
                        {name && (
                          <div style={{ fontSize: nameFs, fontWeight: 400 }}>
                            {name.slice(0, 10)}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    {showBoothForm && (
                      <div
                        id={`floor-plan-booth-${boothForm.id || 'new'}`}
                        onMouseDown={(e) => handleDragStart(e, 'move')}
                        title="Drag to move — drag the bottom-right handle to resize"
                        style={{
                          position: 'absolute',
                          left: `${boothForm.x_pct || 0}%`, top: `${boothForm.y_pct || 0}%`,
                          width: `${boothForm.width_pct || 1}%`, height: `${boothForm.height_pct || 1}%`,
                          background: 'rgba(27, 58, 107, 0.35)', border: '2px dashed #1B3A6B',
                          cursor: 'move', boxSizing: 'border-box', zIndex: 5,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, lineHeight: 1, color: '#1B3A6B', fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap',
                        }}
                      >
                        {boothForm.booth_no || 'new'}
                        <div
                          onMouseDown={(e) => handleDragStart(e, 'resize')}
                          title="Drag to resize"
                          style={{
                            position: 'absolute', right: -5, bottom: -5, width: 10, height: 10,
                            background: '#1B3A6B', borderRadius: '50%', cursor: 'nwse-resize',
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: '#5c6070' }}>No background image uploaded for this hall yet.</p>
          )}

          {isElevated && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button type="button" onClick={() => { if (showBoothForm) { setBoothForm(emptyBoothForm); setShowBoothForm(false); } else { startAddBooth(); } }}>
                {showBoothForm ? 'Cancel' : '+ Add Booth'}
              </button>
              <button type="button" onClick={() => setShowGridForm(!showGridForm)}>
                {showGridForm ? 'Cancel Grid' : 'Generate Grid...'}
              </button>
            </div>
          )}

          {showBoothForm && (
            <form
              onSubmit={handleSaveBooth}
              style={{
                // Floating panel: stays in view wherever the user clicked
                // Edit — no more scrolling around to find the form.
                position: 'fixed', right: 16, top: 'calc(var(--nav-height, 54px) + 12px)', zIndex: 60,
                width: 'min(440px, calc(100vw - 32px))',
                maxHeight: 'calc(100vh - var(--nav-height, 54px) - 28px)', overflowY: 'auto',
                background: '#fff', border: '1px solid #b9c0d0', borderRadius: 8, padding: 16,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>{boothForm.id ? `Edit Booth ${boothForm.booth_no}` : 'Add Booth'}</strong>
                <button type="button" onClick={() => { setBoothForm(emptyBoothForm); setShowBoothForm(false); }} title="Close">✕</button>
              </div>
              <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
                Drag the highlighted box on the map to position it, and its bottom-right dot to resize —
                or fine-tune the exact numbers below.
              </p>
              <label style={label}>Booth No.</label>
              <input style={inputStyle} value={boothForm.booth_no} onChange={(e) => setBoothForm({ ...boothForm, booth_no: e.target.value })} required />
              <label style={label}>Copy size from an existing booth (optional)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={inputStyle} placeholder="e.g. 1401" value={copyFromNo} onChange={(e) => setCopyFromNo(e.target.value)} />
                <button type="button" onClick={applyCopySize}>Copy Size</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>X % (left edge)</label>
                  <input type="number" step="0.01" style={inputStyle} value={boothForm.x_pct} onChange={(e) => setBoothForm({ ...boothForm, x_pct: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Y % (top edge)</label>
                  <input type="number" step="0.01" style={inputStyle} value={boothForm.y_pct} onChange={(e) => setBoothForm({ ...boothForm, y_pct: e.target.value })} required />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Width %</label>
                  <input type="number" step="0.01" style={inputStyle} value={boothForm.width_pct} onChange={(e) => setBoothForm({ ...boothForm, width_pct: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Height %</label>
                  <input type="number" step="0.01" style={inputStyle} value={boothForm.height_pct} onChange={(e) => setBoothForm({ ...boothForm, height_pct: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Sqm</label>
                  <input type="number" step="0.01" style={inputStyle} value={boothForm.sqm} onChange={(e) => setBoothForm({ ...boothForm, sqm: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <label><input type="checkbox" checked={boothForm.is_corner} onChange={(e) => setBoothForm({ ...boothForm, is_corner: e.target.checked })} /> Corner charge</label>
                <label><input type="checkbox" checked={boothForm.is_loading} onChange={(e) => setBoothForm({ ...boothForm, is_loading: e.target.checked })} /> Loading charge</label>
              </div>
              {boothForm.opportunity_id || boothForm.sales_order_id ? (
                <div style={{ marginTop: 12, padding: 10, background: '#f5f5f7', borderRadius: 6 }}>
                  <label style={{ ...label, marginTop: 0 }}>Assigned Exhibitor</label>
                  <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{boothForm.exhibitor_display_name || '—'}</p>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#5c6070' }}>
                    Set from the linked {boothForm.sales_order_id ? 'Contract' : 'Opportunity'} — edit it there, not here,
                    so the two sides never disagree.
                  </p>
                  <label style={label}>Fascia Board Name (what's printed on the physical booth — leave blank to use the exhibitor name)</label>
                  <input
                    style={inputStyle} maxLength={40} value={boothForm.fascia_name}
                    placeholder={boothForm.exhibitor_display_name || ''}
                    onChange={(e) => setBoothForm({ ...boothForm, fascia_name: e.target.value })}
                  />
                  <button type="button" onClick={handleRemoveAssignment}>Remove Assignment</button>
                </div>
              ) : (
                <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={boothForm.status === 'RESERVED'} onChange={(e) => setBoothForm({ ...boothForm, status: e.target.checked ? 'RESERVED' : 'AVAILABLE' })} />
                  Reserved (held back, not yet linked to an Opportunity or Contract)
                </label>
              )}
              <label style={label}>Notes (special build / requests)</label>
              <textarea style={{ ...inputStyle, minHeight: 48 }} value={boothForm.notes} onChange={(e) => setBoothForm({ ...boothForm, notes: e.target.value })} />
              <button type="submit" style={{ marginTop: 12 }}>{boothForm.id ? 'Save Booth' : 'Add Booth'}</button>
            </form>
          )}

          {showGridForm && (
            <form onSubmit={handleGenerateGrid} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16, maxWidth: 500 }}>
              <p style={{ fontSize: 12, color: '#5c6070' }}>
                Generates a rectangular grid of equal-size booths in one go, numbered sequentially row by row —
                the fast starting point for a standard module layout. Edit, split, merge or delete individual
                rows below afterward to match reality.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Starting Booth No.</label>
                  <input type="number" style={inputStyle} value={gridForm.start_no} onChange={(e) => setGridForm({ ...gridForm, start_no: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Rows</label>
                  <input type="number" style={inputStyle} value={gridForm.rows} onChange={(e) => setGridForm({ ...gridForm, rows: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Columns</label>
                  <input type="number" style={inputStyle} value={gridForm.cols} onChange={(e) => setGridForm({ ...gridForm, cols: e.target.value })} required />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Start X %</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.start_x_pct} onChange={(e) => setGridForm({ ...gridForm, start_x_pct: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Start Y %</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.start_y_pct} onChange={(e) => setGridForm({ ...gridForm, start_y_pct: e.target.value })} required />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Cell Width %</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.cell_width_pct} onChange={(e) => setGridForm({ ...gridForm, cell_width_pct: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Cell Height %</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.cell_height_pct} onChange={(e) => setGridForm({ ...gridForm, cell_height_pct: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Sqm per booth</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.sqm} onChange={(e) => setGridForm({ ...gridForm, sqm: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Gap X % (between columns)</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.gap_x_pct} onChange={(e) => setGridForm({ ...gridForm, gap_x_pct: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Gap Y % (between rows)</label>
                  <input type="number" step="0.01" style={inputStyle} value={gridForm.gap_y_pct} onChange={(e) => setGridForm({ ...gridForm, gap_y_pct: e.target.value })} />
                </div>
              </div>
              <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={gridForm.is_loading_edge_col} onChange={(e) => setGridForm({ ...gridForm, is_loading_edge_col: e.target.checked })} />
                Mark first/last column as Loading (aisle-adjacent)
              </label>
              <button type="submit" style={{ marginTop: 12 }}>Generate</button>
            </form>
          )}

          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Booth No</th><th>Sqm</th><th>Corner</th><th>Loading</th><th>Status</th><th>Exhibitor</th><th>Fascia Board</th><th>Notes</th><th></th>
              </tr>
            </thead>
            <tbody>
              {booths.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{b.booth_no}</td>
                  <td>{b.sqm ?? '—'}</td>
                  <td>{b.is_corner ? 'Yes' : ''}</td>
                  <td>{b.is_loading ? 'Yes' : ''}</td>
                  <td>{STATUS_LABELS[b.computed_status] || b.computed_status}</td>
                  <td>{b.exhibitor_display_name || '—'}</td>
                  <td>{(b.opportunity_id || b.sales_order_id) ? (b.fascia_name || b.exhibitor_display_name || '—') : '—'}</td>
                  <td style={{ fontSize: 12, color: '#5c6070' }}>{b.notes || ''}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => handleLocateBooth(b)} title="Scroll the map to this booth">Locate</button>{' '}
                    {!isElevated && b.assigned_salesperson_id === user?.id && (
                      <button type="button" onClick={() => handleEditFascia(b)}>Edit Fascia</button>
                    )}
                    {isElevated && (
                      <>
                        <button onClick={() => startEditBooth(b)}>Edit</button>{' '}
                        <button onClick={() => handleDeleteBooth(b)}>Delete</button>{' '}
                        <input
                          type="number" min="2" placeholder="N"
                          title="Split this booth into N equal booths side by side"
                          value={splitCount[b.id] || ''}
                          onChange={(e) => setSplitCount({ ...splitCount, [b.id]: e.target.value })}
                          style={{ width: 40 }}
                        />{' '}
                        <button onClick={() => handleSplitBooth(b)}>Split</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {booths.length === 0 && <tr><td colSpan={9}>No booths configured yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
