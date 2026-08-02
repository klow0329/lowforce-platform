// Shared formatting + tile styles for the Reports module.
export const fmtMYR = (n) =>
  `RM ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const fmtNum = (n) => Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 1 });

export const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);

// Short axis labels: RM 1.2M / RM 350K
export const fmtMYRShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
};

export const NAVY = '#1B3A6B';
export const ACCENT_BLUE = '#185FA5';
export const GREEN = '#1A9C5B';
export const RED = '#D13434';
export const GRAY = '#8b90a0';

export const tile = {
  flex: '1 1 160px',
  padding: 12,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
};
export const tileLabel = { fontSize: 12, color: '#5c6070' };
export const tileValue = { fontSize: 22, fontWeight: 700, color: NAVY };
