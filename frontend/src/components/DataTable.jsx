import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { exportToExcel } from '../utils/exportExcel';

// Reusable list-table chrome: per-user column chooser + saved views,
// click-header-to-sort, and an Excel-style per-column filter checklist —
// applied to every "table of records" screen (Exhibitors, Opportunities,
// Contracts, Invoices, Aging) so the pattern only needs to be built once.
//
// columns: [{ key, label, render?(row), value?(row) — defaults to row[key],
//              default?: boolean — shown before any saved view loads }]

function useOutsideClose(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);
  return ref;
}

function ColumnsPopover({ columns, visibleKeys, setVisibleKeys, views, screenKey, reloadViews, onClose }) {
  const ref = useOutsideClose(onClose);
  const [newViewName, setNewViewName] = useState('');

  function toggle(key) {
    setVisibleKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }

  async function saveView(setDefault) {
    const name = setDefault ? 'Default' : newViewName.trim();
    if (!name) return;
    await api.createTableView({ screen_key: screenKey, name, columns: visibleKeys, is_default: setDefault });
    setNewViewName('');
    reloadViews();
  }

  async function applyView(view) {
    setVisibleKeys(view.columns);
  }

  async function deleteView(id) {
    await api.deleteTableView(id);
    reloadViews();
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '100%', right: 0, zIndex: 20, marginTop: 4,
        background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 12,
        width: 260, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#5c6070', marginBottom: 6 }}>Columns</div>
      <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
        {columns.map((c) => (
          <label key={c.key} style={{ display: 'block', fontSize: 13, fontWeight: 400, padding: '2px 0' }}>
            <input type="checkbox" checked={visibleKeys.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}
          </label>
        ))}
      </div>

      {views.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#5c6070', marginBottom: 4 }}>Saved Views</div>
          {views.map((v) => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '2px 0' }}>
              <button type="button" onClick={() => applyView(v)} style={{ background: 'none', color: '#1B3A6B', padding: 0, textDecoration: 'underline' }}>
                {v.name}{v.is_default ? ' (default)' : ''}
              </button>
              <button type="button" onClick={() => deleteView(v.id)} style={{ background: 'none', color: '#D13434', padding: '0 4px' }}>✕</button>
            </div>
          ))}
        </>
      )}

      <div style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 8 }}>
        <input
          placeholder="New view name..."
          value={newViewName}
          onChange={(e) => setNewViewName(e.target.value)}
          style={{ width: '100%', padding: 6, fontSize: 13, marginBottom: 6, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => saveView(false)} style={{ fontSize: 12, padding: '4px 8px' }}>Save View</button>
          <button type="button" onClick={() => saveView(true)} style={{ fontSize: 12, padding: '4px 8px' }}>Save as Default</button>
        </div>
      </div>
    </div>
  );
}

function FilterPopover({ values, selected, setSelected, onClose }) {
  const ref = useOutsideClose(onClose);
  const [search, setSearch] = useState('');
  const shown = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));

  function toggle(v) {
    // setSelected here is a plain callback (writes into the parent's filters
    // object), not a real useState setter — build the next Set from the
    // current `selected` prop directly rather than using the functional
    // updater pattern, which would hand it a function instead of a Set.
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setSelected(next);
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4,
        background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 8,
        width: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 6, fontSize: 13, marginBottom: 6, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 6 }}>
        <button type="button" style={{ background: 'none', color: '#1B3A6B', padding: 0 }} onClick={() => setSelected(new Set(values))}>Select all</button>
        <button type="button" style={{ background: 'none', color: '#1B3A6B', padding: 0 }} onClick={() => setSelected(new Set())}>Clear</button>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {shown.map((v) => (
          <label key={v} style={{ display: 'block', fontSize: 13, fontWeight: 400, padding: '2px 0' }}>
            <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} /> {v || '(blank)'}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function DataTable({ screenKey, columns, rows, getRowKey, onRowClick, getRowStyle, exportFilename, exportSheetName }) {
  const defaultKeys = useMemo(() => columns.filter((c) => c.default !== false).map((c) => c.key), [columns]);
  const [visibleKeys, setVisibleKeys] = useState(defaultKeys);
  const [views, setViews] = useState([]);
  const [showColumnsPopover, setShowColumnsPopover] = useState(false);
  const [sort, setSort] = useState(null); // { key, dir: 1 | -1 }
  const [filters, setFilters] = useState({}); // { [key]: Set(values) }
  const [openFilterKey, setOpenFilterKey] = useState(null);
  const [draggedKey, setDraggedKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  function reloadViews() {
    api.listTableViews(screenKey).then(({ views }) => {
      setViews(views);
      const def = views.find((v) => v.is_default);
      if (def) setVisibleKeys(def.columns);
    });
  }

  useEffect(reloadViews, [screenKey]);

  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);
  const visibleColumns = visibleKeys.map((k) => colByKey[k]).filter(Boolean);

  function valueOf(col, row) {
    return col.value ? col.value(row) : row[col.key];
  }

  const filteredRows = useMemo(() => {
    let result = rows;
    for (const [key, selected] of Object.entries(filters)) {
      const col = colByKey[key];
      if (!col || !selected || selected.size === 0) continue;
      result = result.filter((r) => selected.has(String(valueOf(col, r) ?? '')));
    }
    if (sort) {
      const col = colByKey[sort.key];
      result = [...result].sort((a, b) => {
        const av = valueOf(col, a), bv = valueOf(col, b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? sort.dir : av < bv ? -sort.dir : 0;
      });
    }
    return result;
  }, [rows, filters, sort, colByKey]);

  function toggleSort(key) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 1 };
      if (s.dir === 1) return { key, dir: -1 };
      return null;
    });
  }

  function distinctValuesFor(key) {
    const col = colByKey[key];
    const set = new Set(rows.map((r) => String(valueOf(col, r) ?? '')));
    return [...set].sort();
  }

  // Drag a header left/right to reorder columns — reorders visibleKeys in
  // place, the same array Save View/Save as Default already persist, so no
  // separate storage is needed for the new ordering.
  function handleColumnDrop(targetKey) {
    setDragOverKey(null);
    if (!draggedKey || draggedKey === targetKey) { setDraggedKey(null); return; }
    setVisibleKeys((keys) => {
      const next = keys.filter((k) => k !== draggedKey);
      const targetIndex = next.indexOf(targetKey);
      next.splice(targetIndex, 0, draggedKey);
      return next;
    });
    setDraggedKey(null);
  }

  function handleExport() {
    const data = filteredRows.map((row) => {
      const obj = {};
      for (const col of visibleColumns) obj[col.label] = valueOf(col, row);
      return obj;
    });
    exportToExcel(data, exportFilename, exportSheetName);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8, position: 'relative' }}>
        <button type="button" onClick={handleExport}>Export to Excel</button>
        <button type="button" onClick={() => setShowColumnsPopover((s) => !s)}>Columns ▾</button>
        {showColumnsPopover && (
          <ColumnsPopover
            columns={columns}
            visibleKeys={visibleKeys}
            setVisibleKeys={setVisibleKeys}
            views={views}
            screenKey={screenKey}
            reloadViews={reloadViews}
            onClose={() => setShowColumnsPopover(false)}
          />
        )}
      </div>

      <table className="responsive" width="100%" cellPadding="6">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            {visibleColumns.map((col) => (
              <th
                key={col.key}
                draggable
                onDragStart={() => setDraggedKey(col.key)}
                onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== col.key) setDragOverKey(col.key); }}
                onDragLeave={() => setDragOverKey((k) => (k === col.key ? null : k))}
                onDrop={(e) => { e.preventDefault(); handleColumnDrop(col.key); }}
                onDragEnd={() => { setDraggedKey(null); setDragOverKey(null); }}
                title="Drag to reorder columns"
                style={{
                  position: 'relative', whiteSpace: 'nowrap', cursor: 'grab',
                  opacity: draggedKey === col.key ? 0.4 : 1,
                  borderLeft: dragOverKey === col.key && draggedKey && draggedKey !== col.key ? '2px solid #185FA5' : '2px solid transparent',
                }}
              >
                <span style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sort?.key === col.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </span>
                {' '}
                <button
                  type="button"
                  onClick={() => setOpenFilterKey(openFilterKey === col.key ? null : col.key)}
                  title={`Filter ${col.label}`}
                  style={{
                    background: filters[col.key]?.size ? '#185FA5' : 'none',
                    color: filters[col.key]?.size ? '#fff' : '#5c6070',
                    padding: '0 4px', fontSize: 11, borderRadius: 4,
                  }}
                >
                  ▾
                </button>
                {openFilterKey === col.key && (
                  <FilterPopover
                    values={distinctValuesFor(col.key)}
                    selected={filters[col.key] || new Set()}
                    setSelected={(sel) => setFilters((f) => ({ ...f, [col.key]: sel }))}
                    onClose={() => setOpenFilterKey(null)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderBottom: '1px solid #eee', cursor: onRowClick ? 'pointer' : 'default', ...(getRowStyle ? getRowStyle(row) : null) }}
            >
              {visibleColumns.map((col) => (
                <td key={col.key} data-label={col.label}>
                  {col.render ? col.render(row) : valueOf(col, row) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {filteredRows.length === 0 && (
            <tr><td colSpan={visibleColumns.length}>No records.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
