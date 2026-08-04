import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import FloorPlanPresentation from '../components/FloorPlanPresentation';
import ErrorBoundary from '../components/ErrorBoundary';
import InfoTooltip from '../components/InfoTooltip';
import { setUnsavedChanges } from '../utils/unsavedChanges';
import { FIXED_LABELS } from '../components/BillingTemplate';
import { toTitleCase } from '../utils/format';
import { fitBoothName, fitUniformBoothNumberSize, truncateBoothName } from '../utils/boothLabelFit';
import { downloadPdf } from '../utils/pdf';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const section = { marginBottom: 32 };

const emptyBoothForm = {
  id: null, booth_no: '', x_pct: '', y_pct: '', width_pct: '', height_pct: '', sqm: '',
  is_corner: false, is_loading: false, status: 'AVAILABLE',
  opportunity_id: null, sales_order_id: null, exhibitor_display_name: '', fascia_name: '', notes: '',
  addon_codes: [],
};

// Every field starts blank/'unchanged' — bulk edit only overwrites what the
// user actually fills in, so applying it to a mixed batch of booths never
// wipes out sqm on some just because the user only meant to set Fascia.
const emptyBulkForm = { sqm: '', is_corner: '', is_loading: '', fascia_name: '', notes: '' };

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
// PENDING_RELEASE = a Credit Note still only PENDING_APPROVAL has staged
// this booth to be given up — not yet actually released (Management may
// still reject the CN), shown distinctly from a normal Sold booth so other
// reps get an early heads-up without anyone being able to claim it yet.
// Fully opaque — a booth box sits directly over the hall background image
// (which, for a scanned/converted floor plan PDF, often already has its own
// printed booth number baked into the pixels underneath); any transparency
// here lets that original number show faintly through ours, "ghosting"
// worse the higher you zoom in.
const STATUS_COLORS = {
  AVAILABLE: 'rgb(214, 235, 219)',
  RESERVED: 'rgb(211, 214, 242)',
  PROPOSED: 'rgb(247, 228, 187)',
  SOLD: 'rgb(243, 209, 209)',
  PENDING_RELEASE: 'rgb(214, 188, 250)',
};
const STATUS_BORDER = { AVAILABLE: '#1E7B34', RESERVED: '#4a4fb0', PROPOSED: '#8a6d1a', SOLD: '#c83c3c', PENDING_RELEASE: '#7a3fc9' };
const STATUS_LABELS = { AVAILABLE: 'Available', RESERVED: 'Reserved', PROPOSED: 'Proposed', SOLD: 'Sold', PENDING_RELEASE: 'Pending Release' };

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
  const [savingPdf, setSavingPdf] = useState(false);

  const [booths, setBooths] = useState([]);
  const [boothForm, setBoothForm] = useState(emptyBoothForm);
  const [showBoothForm, setShowBoothForm] = useState(false);
  const [copyFromNo, setCopyFromNo] = useState('');
  const [splitCount, setSplitCount] = useState({});
  const [gridForm, setGridForm] = useState(emptyGridForm);
  const [showGridForm, setShowGridForm] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkForm, setBulkForm] = useState(emptyBulkForm);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState('');
  const [imgVersion, setImgVersion] = useState(0);
  const [imgHeightPx, setImgHeightPx] = useState(0); // for fitting booth label fonts to box height
  // One fixed booth-number size for the whole hall, capped at the target
  // and shrunk only as far as the smallest booth actually needs — see
  // fitUniformBoothNumberSize.
  const uniformNumFs = useMemo(() => {
    if (imgHeightPx <= 0) return 11;
    return fitUniformBoothNumberSize(booths.map((b) => ({
      boothNo: b.booth_no,
      boxW: (Number(b.width_pct) / 100) * 1040,
      boxH: (Number(b.height_pct) / 100) * imgHeightPx,
    })));
  }, [booths, imgHeightPx]);
  const [presenting, setPresenting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [highlightedBoothId, setHighlightedBoothId] = useState(null);
  // Booth mass pickup (pickFor.mode === 'cap') — staged locally (id -> booth
  // detail) until "OK" commits the whole set in one shot via the bulk-set
  // endpoint; nothing is written to the database while the user is still
  // adding/removing booths. Keyed by id (not tied to the currently loaded
  // hall) so the running total and Hall/Booth No preview stay correct across
  // hall switches. Pre-seeded from whatever the record already holds, so
  // re-opening the picker shows the existing pick rather than starting empty.
  const [capSelected, setCapSelected] = useState(new Map());
  const [capLoaded, setCapLoaded] = useState(false);
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
  // For the booth list's Country/Booth Type columns — country full names and
  // a code->label map (Price List description, falling back to the same
  // fixed labels BillingTemplate uses) so a booth's allocated_item_code
  // ('SSS', 'BAS', an admin-added code, ...) reads as real English there too.
  const [countryNames, setCountryNames] = useState({});
  const [priceList, setPriceList] = useState([]);
  useEffect(() => {
    api.listCountries().then(({ countries }) => setCountryNames(Object.fromEntries(countries.map((c) => [c.code, c.name]))));
  }, []);
  useEffect(() => {
    if (!selectedEventId) return;
    api.listPriceList(selectedEventId).then(({ priceList }) => setPriceList(priceList));
  }, [selectedEventId]);
  // Which sales_item_code is the event's admin-flagged primary base item
  // (BillingTemplate.jsx's is_primary_base) — falls back to 'BAS' for an
  // event that hasn't flagged one, so an untagged booth still defaults the
  // same way it always has.
  const primaryBaseCode = priceList.find((p) => p.is_primary_base)?.sales_item_code || 'BAS';
  // Any admin-flagged is_booth_related item OTHER than Corner/Loading, which
  // already have their own dedicated checkboxes above — see migration 070.
  // A company adding a new one here needs no code change, same principle as
  // the Upgrade/addon lists elsewhere in this app.
  const boothAddonCodes = [...new Set(
    priceList.filter((p) => p.is_booth_related && p.sales_item_code !== 'COR' && p.sales_item_code !== 'LOD').map((p) => p.sales_item_code)
  )];
  function boothTypeLabel(code) {
    if (!code) return '—';
    const fromPriceList = priceList.find((p) => p.sales_item_code === code)?.description;
    return toTitleCase(fromPriceList || FIXED_LABELS[code] || code);
  }

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

  useEffect(() => {
    if ((pickFor?.mode !== 'cap' && pickFor?.mode !== 'cn') || capLoaded) return;
    // 'cap' mode is seeded directly from whatever the calling Opportunity/
    // Contract form currently has staged (may not be saved to the database
    // yet — see that page's handlePickBooths) rather than a server fetch, so
    // this works identically for a brand-new, never-saved record too. 'cn'
    // mode still fetches live, since a Credit Note only ever applies to an
    // already-saved contract.
    if (pickFor.mode === 'cap') {
      const m = new Map();
      for (const b of pickFor.preSelectedBooths || []) m.set(b.id, b);
      setCapSelected(m);
      setCapLoaded(true);
      return;
    }
    api.listSalesOrderBooths(pickFor.recordId).then(({ booths: existing }) => {
      const m = new Map();
      // Seed each booth's REAL current type from its live claim, not just
      // Bare Space — otherwise the picker's dropdown opens showing every
      // booth as untyped/Bare Space regardless of what it actually is
      // (2026-08-01 user report on the Value Change flow's booth adjuster).
      for (const b of existing) {
        m.set(b.id, {
          id: b.id, booth_no: b.booth_no, sqm: b.sqm, hall_name: b.hall_name,
          is_corner: b.is_corner, is_loading: b.is_loading,
          allocated_item_code: b.allocated_item_code || primaryBaseCode,
        });
      }
      setCapSelected(m);
      setCapLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickFor, capLoaded]);
  // History is per-hall — switching halls clears it so an undo can never
  // land on a booth in a different hall.
  useEffect(() => { setUndoStack([]); setRedoStack([]); }, [hallId]);

  // Warns before the user navigates away (nav bar links, tab close/refresh)
  // with the floating booth editor open — cleared on unmount/close so it
  // never leaks onto the next page after a confirmed discard or a Save.
  useEffect(() => {
    setUnsavedChanges(showBoothForm, 'You have an unsaved booth edit open that will be lost if you leave. Continue?');
    return () => setUnsavedChanges(false);
  }, [showBoothForm]);

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

  // Hi-res + a page sized to match the map's own aspect ratio (not a fixed
  // A1 rectangle, which left the map stranded in a corner with empty
  // margin whenever the hall's own proportions didn't match A1) so the
  // export fills the sheet and can be zoomed into for audit purposes
  // without the booth labels turning to mush — mirrors Presentation mode's
  // Save as PDF (see FloorPlanPresentation.jsx).
  async function handleDownloadPdf() {
    setSavingPdf(true);
    const priorZoom = zoom;
    try {
      // Capture at zoom=100% regardless of what the user was viewing at —
      // this capture target sits inside a `transform: scale(zoom)`
      // ancestor, so exporting mid-zoom would otherwise scale the raster
      // oddly. Wait a tick for the reflow to actually paint first.
      if (priorZoom !== 1) {
        setZoom(1);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      // A0 at scale 4 (the old numbers here) rasterized at only ~89 DPI —
      // a PDF viewer's "zoom in" just magnifies whatever pixels are actually
      // embedded, so a huge physical page with a modest pixel count is what
      // was making zoomed-in text/labels look soft, not the physical mm
      // size itself. A1's long edge with a much higher scale roughly
      // triples the embedded pixel count (and lands at ~250 DPI, sharp for
      // physical printing too) without an unreasonably large canvas.
      //
      // The page format is computed HERE, upfront, from state that's
      // already reliably known (the capture target is always exactly 1040px
      // wide, imgHeightPx is set on the hall image's own onLoad) — not via
      // html2pdf's post-capture recompute-and-reset-pageSize path (a
      // longEdge option once threaded through to pdf.js): that path
      // re-derives the page format from the captured canvas AFTER
      // toContainer() has already run once using whatever pageSize was
      // cached from the Worker's construction-time default ('a4'), sizing
      // the actual html2canvas capture container to A4's width regardless
      // of what the recomputed format said afterwards — which is what was
      // leaving the real map rendered small in a corner of an unrelated
      // page shape. Passing the correct format from the very first call
      // sidesteps that caching order entirely.
      const aspect = imgHeightPx > 0 ? 1040 / imgHeightPx : 1;
      const longEdgeMm = 841;
      const format = aspect >= 1 ? [longEdgeMm, longEdgeMm / aspect] : [longEdgeMm * aspect, longEdgeMm];
      await downloadPdf(
        'floor-plan-normal-capture', `${selectedHall.name}-${new Date().toISOString().slice(0, 10)}`, 'landscape',
        { scale: 8, format, margin: 0, width: 1040, height: imgHeightPx }
      );
    } finally {
      if (priorZoom !== 1) setZoom(priorZoom);
      setSavingPdf(false);
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
      addon_codes: b.addon_codes || [],
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
    if (pickFor?.mode === 'cap' || pickFor?.mode === 'cn') handleCapToggle(b);
    else if (isElevated) startEditBooth(b);
    else if (b.assigned_salesperson_id && b.assigned_salesperson_id === user?.id) handleEditFascia(b);
  }

  // Booth mass pickup — toggles a booth in/out of the staged selection
  // (capSelected), enforcing the Total Sqm cap client-side as a UX guard
  // (the bulk-set endpoint re-checks it server-side, which is the real
  // gate). Nothing is written to the database here — see handleCapCommit.
  function handleCapToggle(b) {
    setCapSelected((prev) => {
      if (prev.has(b.id)) {
        const next = new Map(prev);
        next.delete(b.id);
        return next;
      }
      // pickFor.recordId is null for a not-yet-saved record (see that page's
      // handlePickBooths) — guard explicitly so that case never matches a
      // booth whose own link column happens to be null too (e.g. a
      // Reserved booth nobody's claimed), which would wrongly bypass the
      // block below.
      const belongsToThisRecord = Boolean(pickFor.recordId) && (pickFor.recordType === 'contract'
        ? b.sales_order_id === pickFor.recordId
        : b.opportunity_id === pickFor.recordId);
      // A still-Proposed booth can be claimed by more than one Opportunity/
      // draft Contract at once — whichever one gets its Contract approved
      // first wins it for real, auto-releasing every other claim (see
      // approveSalesOrder). Only a genuinely SOLD, Reserved, or
      // mid-Credit-Note-release booth is off-limits to a new claimant.
      const blocked = ['SOLD', 'RESERVED', 'PENDING_RELEASE'].includes(b.computed_status);
      if (blocked && !belongsToThisRecord) {
        window.alert(`Booth ${b.booth_no} is already ${b.computed_status === 'SOLD' ? 'taken' : b.computed_status.toLowerCase().replace('_', ' ')}.`);
        return prev;
      }
      const currentTotal = [...prev.values()].reduce((sum, x) => sum + (Number(x.sqm) || 0), 0);
      const newTotal = currentTotal + (Number(b.sqm) || 0);
      if (pickFor.cap && newTotal > pickFor.cap) {
        window.alert(`Adding booth ${b.booth_no} (${b.sqm || 0} sqm) would bring the total to ${newTotal} sqm, which exceeds the Total Sqm cap of ${pickFor.cap}. Deselect another booth first, or increase Total Sqm on the ${pickFor.recordType === 'contract' ? 'contract' : 'opportunity'}.`);
        return prev;
      }
      const next = new Map(prev);
      next.set(b.id, {
        id: b.id, booth_no: b.booth_no, sqm: b.sqm, hall_name: selectedHall?.name, is_corner: b.is_corner, is_loading: b.is_loading,
        // Defaults to the primary base item (e.g. Bare Space) — always a
        // real, resolved value the moment a booth is picked, so the
        // dropdown below always has something selected and Save is never
        // blocked waiting on a "which type?" choice. Sales picks the actual
        // type (2026-08-01 user request: every booth's type must be
        // choosable right here, before Save, not only discoverable after
        // the fact once the system happens to notice a mix).
        allocated_item_code: primaryBaseCode,
      });
      return next;
    });
  }

  // Which booth is Bare Space vs which upgrade tier — shown as a per-booth
  // dropdown for every selected booth (not just once the record already
  // happens to be mixing types), so Sales can set the real type up front
  // instead of it silently defaulting to Bare Space until corrected later.
  function setCapItemCode(boothId, code) {
    setCapSelected((prev) => {
      const b = prev.get(boothId);
      if (!b) return prev;
      const next = new Map(prev);
      next.set(boothId, { ...b, allocated_item_code: code });
      return next;
    });
  }

  // Nothing is written to the database here — this just hands the staged
  // selection back to whichever Opportunity/Contract form sent us here (see
  // that page's handlePickBooths); it only actually saves once the user
  // hits Save on that form, same as 'cn' mode below. Each booth already
  // carries its own resolved type (defaulted to the primary base item when
  // added, changeable via the per-booth dropdown below), so nothing needs
  // resolving here.
  function handleCapCommit() {
    navigate(pickFor.returnPath, { state: { pickedBooths: [...capSelected.values()] } });
  }

  // 'cn' mode never writes to the database here — a Credit Note isn't real
  // until Management approves it, so nothing about the booth's actual link
  // may change yet (see creditNotes.controller.js's approveCreditNote,
  // which is the only place this ever actually takes effect). Instead this
  // just hands the still-selected set back to the CN request form; it
  // derives released_booth_ids as whatever was linked before minus whatever
  // is still selected now.
  function handleCnCommit() {
    // Full objects (not just ids) so the calling form can also see each
    // surviving booth's chosen type — previously only the id list came
    // back, so re-tagging a booth here (Bare Space -> Corner, say) had
    // nowhere to go and was silently discarded (2026-08-01).
    navigate(pickFor.returnPath, {
      state: { cnBoothsPicked: true, cnSelectedBooths: [...capSelected.values()] },
    });
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

  function toggleBulkSelected(boothId) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(boothId)) next.delete(boothId); else next.add(boothId);
      return next;
    });
  }

  // Selects every currently-listed booth in one click — the user can then
  // untick individual ones rather than clicking through a large hall booth
  // by booth.
  function toggleSelectAllBulk(checked) {
    setBulkSelected(checked ? new Set(booths.map((b) => b.id)) : new Set());
  }

  async function handleApplyBulkEdit() {
    setError('');
    const payload = { booth_ids: [...bulkSelected] };
    if (bulkForm.sqm !== '') payload.sqm = bulkForm.sqm;
    if (bulkForm.is_corner !== '') payload.is_corner = bulkForm.is_corner === 'true';
    if (bulkForm.is_loading !== '') payload.is_loading = bulkForm.is_loading === 'true';
    if (bulkForm.fascia_name !== '') payload.fascia_name = bulkForm.fascia_name;
    if (bulkForm.notes !== '') payload.notes = bulkForm.notes;
    if (Object.keys(payload).length === 1) {
      setError('Fill in at least one field to apply.');
      return;
    }
    setBulkSaving(true);
    try {
      const { updated } = await api.bulkUpdateFloorPlanBooths(hallId, payload);
      setBulkMode(false);
      setBulkSelected(new Set());
      setBulkForm(emptyBulkForm);
      loadBooths();
      window.alert(`Updated ${updated} booth(s).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkSaving(false);
    }
  }

  if (presenting && selectedHall) {
    const hallIndex = halls.findIndex((h) => h.id === hallId);
    const goToHall = (delta) => {
      if (halls.length < 2) return;
      const next = (hallIndex + delta + halls.length) % halls.length;
      setHallId(halls[next].id);
    };
    return (
      <ErrorBoundary label="Presentation Mode" onReset={() => setPresenting(false)}>
        <FloorPlanPresentation
          hallName={selectedHall.name}
          imageUrl={`${api.floorPlanHallImageUrl(hallId)}?v=${imgVersion}`}
          booths={booths}
          onClose={() => setPresenting(false)}
          onPrevHall={halls.length > 1 ? () => goToHall(-1) : undefined}
          onNextHall={halls.length > 1 ? () => goToHall(1) : undefined}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '40px auto' }}>
      <h2>Floor Plan</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {(pickFor?.mode === 'cap' || pickFor?.mode === 'cn') && (() => {
        const isCn = pickFor.mode === 'cn';
        const selected = [...capSelected.values()];
        const total = selected.reduce((sum, b) => sum + (Number(b.sqm) || 0), 0);
        const overCap = pickFor.cap && total > pickFor.cap;
        const typeOptions = [{ code: primaryBaseCode, label: boothTypeLabel(primaryBaseCode) }, ...(pickFor?.upgradeOptions || [])];
        const typeLabel = (code) => typeOptions.find((t) => t.code === code)?.label || code;
        // Live per-type sum — every selected booth's type is picked right
        // here via the dropdown below (defaults to the primary base item),
        // so this is always a complete, resolved breakdown, not just a
        // cross-check against old figures.
        const typeSums = {};
        for (const b of selected) {
          const code = b.allocated_item_code || primaryBaseCode;
          typeSums[code] = (typeSums[code] || 0) + (Number(b.sqm) || 0);
        }
        return (
          <div
            style={{
              background: isCn ? '#F3E8FF' : '#E3F2FD', border: `1px solid ${isCn ? '#C9A6F5' : '#90CAF9'}`, borderRadius: 8, padding: 12, margin: '12px 0',
              position: 'sticky', top: 'var(--nav-height, 54px)', zIndex: 45, boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>
                Picking booths for <strong>{pickFor.exhibitorName}</strong>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ color: overCap ? '#c83c3c' : '#1E7B34', whiteSpace: 'nowrap', fontSize: 14 }}>
                  Total: {total} sqm{pickFor.cap ? ` / ${pickFor.cap} sqm cap` : ''}
                </strong>
                <InfoTooltip text="Click available (green) booths to add, click a selected (blue-bordered) booth again to remove, and use each booth's own dropdown to set its type. You can also add a Proposed (yellow) booth someone else hasn't sold yet — several deals can propose the same booth until one of them gets its contract approved, which wins it and releases the others. Switch halls freely; your selection is kept. Nothing is saved until you commit this back on the other screen." />
                <button type="button" onClick={() => navigate(pickFor.returnPath)}>Cancel</button>
                <button
                  type="button" onClick={isCn ? handleCnCommit : handleCapCommit}
                  disabled={overCap} style={{ fontWeight: 600 }}
                >
                  OK — Save Selection
                </button>
              </div>
            </div>
            {selected.length > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#1B3A6B' }}>
                {Object.entries(typeSums).map(([code, sum]) => `${typeLabel(code)} ${sum} sqm`).join(', ')}.
              </p>
            )}
            {selected.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selected.map((b) => (
                  <span
                    key={b.id}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff',
                      border: '1px solid #90CAF9',
                      borderRadius: 12, padding: '2px 8px 2px 10px', fontSize: 12,
                    }}
                  >
                    {b.hall_name ? `${b.hall_name} — ` : ''}{b.booth_no} ({b.sqm || 0} sqm)
                    <select
                      value={b.allocated_item_code || primaryBaseCode} onChange={(e) => setCapItemCode(b.id, e.target.value)}
                      style={{ fontSize: 11, padding: '1px 2px', border: 'none', background: 'transparent' }}
                    >
                      {typeOptions.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <div style={section}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Hall:</label>
          <select value={hallId} onChange={(e) => setHallId(e.target.value)} style={{ padding: 8 }}>
            {halls.length === 0 && <option value="">No halls yet</option>}
            {halls.map((h) => (
              <option key={h.id} value={h.id}>{h.name} ({h.booth_count} booths, {h.occupied_count} occupied)</option>
            ))}
          </select>
          {/* Allocation tally for the hall currently selected — the Floor
              Plan drives booth allocation now, so this is the authoritative
              "how full is this hall" figure that the booth list below
              should agree with. */}
          {selectedHall && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13 }}>
                <span style={{ color: '#5c6070' }}>Booths: </span>
                <strong>{Number(selectedHall.occupied_count) || 0} / {Number(selectedHall.booth_count) || 0}</strong>
                <span style={{ color: '#5c6070' }}>
                  {' '}(sold {Number(selectedHall.sold_count) || 0}, proposed {Number(selectedHall.proposed_count) || 0})
                </span>
              </div>
              <div style={{ fontSize: 13 }}>
                <span style={{ color: '#5c6070' }}>Sqm: </span>
                <strong>
                  {(Number(selectedHall.occupied_sqm) || 0).toLocaleString('en-MY')} / {(Number(selectedHall.total_sqm) || 0).toLocaleString('en-MY')} sqm
                </strong>
                {Number(selectedHall.total_sqm) > 0 && !Number(selectedHall.booths_without_sqm) && (
                  <span style={{ color: '#5c6070' }}>
                    {' '}({Math.round((Number(selectedHall.occupied_sqm) || 0) / Number(selectedHall.total_sqm) * 100)}%)
                  </span>
                )}
                <span style={{ color: '#5c6070' }}>
                  {' '}(sold {(Number(selectedHall.sold_sqm) || 0).toLocaleString('en-MY')}, proposed {(Number(selectedHall.proposed_sqm) || 0).toLocaleString('en-MY')})
                </span>
              </div>
              {/* The percentage is deliberately hidden while any booth is
                  missing its sqm — the denominator would be understated,
                  making a half-empty hall read as 100% allocated. */}
              {Number(selectedHall.booths_without_sqm) > 0 && (
                <div style={{ fontSize: 12, color: '#B45309', background: '#FEF3C7', padding: '3px 8px', borderRadius: 6 }}>
                  {Number(selectedHall.booths_without_sqm)} booth(s) have no sqm set — hall capacity is incomplete
                </div>
              )}
            </div>
          )}
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
                <button type="button" onClick={handleDownloadPdf} disabled={savingPdf} title="Download a hi-res PDF of this hall — zoomable for audit purposes">
                  {savingPdf ? 'Saving...' : '⬇ Download PDF'}
                </button>
                <span style={{ fontSize: 12, color: '#5c6070' }}>Ctrl+scroll on the map to zoom too</span>
                <span style={{ display: 'inline-flex', gap: 10, marginLeft: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  {Object.keys(STATUS_LABELS).map((status) => (
                    <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#5c6070' }}>
                      <span style={{
                        width: 12, height: 12, borderRadius: 3, display: 'inline-block',
                        background: STATUS_COLORS[status], border: `1px solid ${STATUS_BORDER[status]}`,
                      }} />
                      {STATUS_LABELS[status]}
                    </span>
                  ))}
                </span>
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
                {/* This spacer is sized to the POST-zoom pixel dimensions —
                    not just wrapped in transform: scale — so the scroll
                    container's own scrollWidth/scrollHeight are computed
                    normally from real layout size rather than from a
                    transformed child's ink overflow. Relying on the
                    transform alone left some browsers unable to scroll all
                    the way to the top/left of a zoomed-in map (could reach
                    bottom/right, where the scale grows the box, but not
                    back past a whole-container-width's worth toward the
                    origin) — an explicitly sized spacer sidesteps that
                    entirely and scrolls symmetrically in every direction. */}
                <div style={{ width: 1040 * zoom, height: imgHeightPx ? imgHeightPx * zoom : undefined }}>
                  <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', width: 'fit-content' }}>
                  <div id="floor-plan-normal-capture" ref={imgWrapRef} style={{ position: 'relative', display: 'inline-block' }}>
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
                      const numFs = uniformNumFs;
                      const nameAvailH = Math.max(0, boxH - numFs * 1.15 - 3);
                      const nameFs = fitBoothName(name, boxW, nameAvailH);
                      const displayName = truncateBoothName(name, nameFs, boxW, nameAvailH);
                      const isCapSelected = (pickFor?.mode === 'cap' || pickFor?.mode === 'cn') && capSelected.has(b.id);
                      // Several Opportunities can propose the same booth
                      // until a Contract is approved (competing-claims
                      // rule). One claim reads normally off the booth's own
                      // label; 2+ get a count badge, with the full
                      // breakdown in the hover tooltip — otherwise the map
                      // silently shows only whichever claim happens to be
                      // primary, hiding that the booth is contested.
                      const claims = b.claims || [];
                      const contested = claims.length > 1;
                      const claimLines = contested
                        ? `\n\n${claims.length} exhibitors proposing this booth:\n`
                          + claims.map((c, i) => `${i + 1}. ${c.exhibitor_name || 'Unknown'}`
                            + `${c.salesperson_name ? ` — ${c.salesperson_name}` : ''}`
                            + `${c.record_type === 'sales_order' ? ' [CONTRACT]' : ' [proposed]'}`).join('\n')
                        : '';
                      return (
                      <div
                        key={b.id}
                        id={`floor-plan-booth-${b.id}`}
                        title={`${b.booth_no}${name ? ` — ${b.fascia_name || b.exhibitor_display_name}` : ''}${b.is_loading ? ' [LOADING]' : ''}${b.is_corner ? ' [CORNER]' : ''}${claimLines}`}
                        onClick={() => handleBoothClick(b)}
                        style={{
                          position: 'absolute',
                          left: `${b.x_pct}%`, top: `${b.y_pct}%`, width: `${b.width_pct}%`, height: `${b.height_pct}%`,
                          background: STATUS_COLORS[b.computed_status] || STATUS_COLORS.AVAILABLE,
                          border: isCapSelected
                            ? '3px solid #1565C0'
                            : (highlightedBoothId === b.id ? '2px solid #ff5500' : `1px solid ${STATUS_BORDER[b.computed_status] || STATUS_BORDER.AVAILABLE}`),
                          boxShadow: isCapSelected
                            ? '0 0 0 3px rgba(21, 101, 192, 0.35)'
                            : (highlightedBoothId === b.id ? '0 0 0 4px rgba(255, 85, 0, 0.35)' : 'none'),
                          cursor: (isElevated || pickFor || b.assigned_salesperson_id === user?.id) ? 'pointer' : 'default',
                          lineHeight: 1.05, color: '#1B3A6B', overflow: 'hidden', boxSizing: 'border-box',
                          whiteSpace: 'nowrap',
                          // flex-start (not center) pins the booth number to
                          // right under the top border on every booth,
                          // regardless of how many lines the name below it
                          // wraps to — centering the whole block let the
                          // number drift toward the middle on boxes with a
                          // short (or no) name, per the user's explicit
                          // feedback (2026-07-31).
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', textAlign: 'center', padding: 1,
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: numFs }}>{b.booth_no}</div>
                        {displayName && (
                          <div style={{ fontSize: nameFs, fontWeight: 400, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', maxWidth: '100%' }}>
                            {displayName}
                          </div>
                        )}
                        {contested && (
                          <div
                            style={{
                              position: 'absolute', top: 1, right: 1,
                              background: '#B45309', color: '#fff', borderRadius: '50%',
                              minWidth: Math.max(9, numFs * 1.2), height: Math.max(9, numFs * 1.2),
                              fontSize: Math.max(6, numFs * 0.85), fontWeight: 700, lineHeight: `${Math.max(9, numFs * 1.2)}px`,
                              textAlign: 'center', pointerEvents: 'none',
                            }}
                          >
                            {claims.length}
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
              <button
                type="button"
                onClick={() => {
                  if (bulkMode) { setBulkMode(false); setBulkSelected(new Set()); setBulkForm(emptyBulkForm); }
                  else setBulkMode(true);
                }}
              >
                {bulkMode ? 'Cancel Bulk Edit' : 'Bulk Edit...'}
              </button>
            </div>
          )}

          {bulkMode && (
            <div style={{ background: '#FFF8E1', border: '1px solid #F0D98C', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <p style={{ fontSize: 13, margin: '0 0 10px' }}>
                Tick booths in the table below, fill in only the fields you want to change (leave the rest blank), then Apply.
                Currently selected: <strong>{bulkSelected.size}</strong> booth(s).
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ ...label, marginTop: 0 }}>Sqm</label>
                  <input type="number" step="0.01" placeholder="Unchanged" style={{ ...inputStyle, width: 100 }}
                    value={bulkForm.sqm} onChange={(e) => setBulkForm({ ...bulkForm, sqm: e.target.value })} />
                </div>
                <div>
                  <label style={{ ...label, marginTop: 0 }}>Corner</label>
                  <select style={{ ...inputStyle, width: 110 }} value={bulkForm.is_corner} onChange={(e) => setBulkForm({ ...bulkForm, is_corner: e.target.value })}>
                    <option value="">Unchanged</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label style={{ ...label, marginTop: 0 }}>Loading</label>
                  <select style={{ ...inputStyle, width: 110 }} value={bulkForm.is_loading} onChange={(e) => setBulkForm({ ...bulkForm, is_loading: e.target.value })}>
                    <option value="">Unchanged</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label style={{ ...label, marginTop: 0 }}>Fascia Board</label>
                  <input placeholder="Unchanged" style={{ ...inputStyle, width: 160 }}
                    value={bulkForm.fascia_name} onChange={(e) => setBulkForm({ ...bulkForm, fascia_name: e.target.value })} />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ ...label, marginTop: 0 }}>Notes</label>
                  <input placeholder="Unchanged" style={inputStyle}
                    value={bulkForm.notes} onChange={(e) => setBulkForm({ ...bulkForm, notes: e.target.value })} />
                </div>
                <button type="button" onClick={handleApplyBulkEdit} disabled={bulkSelected.size === 0 || bulkSaving} style={{ fontWeight: 600 }}>
                  {bulkSaving ? 'Applying...' : `Apply to ${bulkSelected.size} booth(s)`}
                </button>
              </div>
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
                {boothAddonCodes.map((code) => (
                  <label key={code}>
                    <input
                      type="checkbox" checked={boothForm.addon_codes.includes(code)}
                      onChange={(e) => setBoothForm({
                        ...boothForm,
                        addon_codes: e.target.checked
                          ? [...boothForm.addon_codes, code]
                          : boothForm.addon_codes.filter((c) => c !== code),
                      })}
                    />
                    {' '}{boothTypeLabel(code)}
                  </label>
                ))}
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
                {bulkMode && (
                  <th>
                    <input
                      type="checkbox"
                      checked={booths.length > 0 && bulkSelected.size === booths.length}
                      onChange={(e) => toggleSelectAllBulk(e.target.checked)}
                      title="Select all"
                    />
                  </th>
                )}
                <th>Booth No</th><th>Sqm</th><th>Corner</th><th>Loading</th>
                {boothAddonCodes.length > 0 && <th>Booth Items</th>}
                <th>Status</th><th>Booth Type</th><th>Country</th><th>Sales Agent</th><th>Exhibitor</th><th>Fascia Board</th><th>Notes</th><th></th>
              </tr>
            </thead>
            <tbody>
              {booths.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}>
                  {bulkMode && (
                    <td>
                      <input type="checkbox" checked={bulkSelected.has(b.id)} onChange={() => toggleBulkSelected(b.id)} />
                    </td>
                  )}
                  <td>{b.booth_no}</td>
                  <td>{b.sqm ?? '—'}</td>
                  <td>{b.is_corner ? 'Yes' : ''}</td>
                  <td>{b.is_loading ? 'Yes' : ''}</td>
                  {boothAddonCodes.length > 0 && (
                    <td>{(b.addon_codes || []).map((c) => boothTypeLabel(c)).join(', ')}</td>
                  )}
                  <td>{STATUS_LABELS[b.computed_status] || b.computed_status}</td>
                  <td>{b.exhibitor_display_name ? boothTypeLabel(b.allocated_item_code || primaryBaseCode) : '—'}</td>
                  <td>{(countryNames[b.booth_country] || b.booth_country) || '—'}</td>
                  <td>{b.agent_name || '—'}</td>
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
              {booths.length === 0 && <tr><td colSpan={bulkMode ? 13 : 12}>No booths configured yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
