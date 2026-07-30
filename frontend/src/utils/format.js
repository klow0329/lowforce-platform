// Display-only casing helper — the underlying data (price list descriptions,
// printed documents) intentionally stays uppercase elsewhere in the app;
// this is only for list screens where a wall of ALL CAPS text is hard to
// scan next to normally-cased columns.
export function toTitleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
