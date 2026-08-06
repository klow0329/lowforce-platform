import { api } from '../api/client';

// Renders nothing until the tenant uploads their own — this slot is their
// identity specifically, so it should never show a placeholder (LowForce's
// own mark lives in its own dedicated nav-bar spot, not here) or another
// real customer's leftover branding. Matches the same "render nothing until
// set" convention LetterheadBand/FooterBand/EventBrandLogo already use.
//
// height/maxWidth are a bounding box, not a fixed size — an uploaded logo's
// real aspect ratio is unknown (a wide horizontal lockup with a lot of text,
// like a typical event logo, renders very wide at a given height), and a
// document header showing two logos side by side (this + EventBrandLogo)
// needs each one capped on both axes or the wider one pushes the other
// past the visible page edge. object-fit: contain + explicit width/height:
// 'auto' (not the `height` prop's raw px value) lets the browser shrink
// whichever axis is the binding constraint, never stretching or cropping.
export function BrandLogo({ company, height = 44, maxWidth = 180, style }) {
  if (!company?.has_logo) return null;
  return (
    <img
      src={api.brandingImageUrl('logo')} alt=""
      style={{ maxHeight: height, maxWidth, width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', marginBottom: 6, ...style }}
    />
  );
}

// Full-width header/footer strips — only render once the company has
// actually uploaded one, so documents aren't left with empty gaps.
export function LetterheadBand({ company }) {
  if (!company?.has_letterhead) return null;
  return <img src={api.brandingImageUrl('letterhead')} alt="" style={{ width: '100%', display: 'block', marginBottom: 16 }} />;
}

export function FooterBand({ company }) {
  if (!company?.has_footer) return null;
  return <img src={api.brandingImageUrl('footer')} alt="" style={{ width: '100%', display: 'block', marginTop: 16 }} />;
}

// The event/brand identity (e.g. "MIFB") is often distinct from the
// operating company's own name/logo — shown on customer-facing event forms
// (Contract/Application/Proposal) alongside the company's own branding,
// rather than replacing it. Renders nothing until Admin sets it up.
//
// Resolves per-document once `company.main_event_id` is present (set by
// getCompany when called with the document's event_id, which resolves to
// that event's MAIN-tier ancestor — see reference.controller.js) — a
// company running more than one Main (e.g. MIFB and a second brand) gets a
// different logo per document, not one shared company-wide image. Falls
// back to the old company-wide slot for any company that hasn't
// introduced the Main tier yet, so nothing breaks for them.
export function EventBrandLogo({ company, height = 44, maxWidth = 220, style }) {
  if (!company?.has_event_logo) return null;
  const src = company.main_event_id ? api.eventLogoUrl(company.main_event_id) : api.brandingImageUrl('event_logo');
  // See BrandLogo's own comment — height/maxWidth is a bounding box, not a
  // fixed size, so a wide event logo (a typical icon + multi-line text
  // lockup) scales down to fit instead of pushing past the page edge.
  // Event logos tend to run wider than a company's own square-ish mark, so
  // this gets a slightly larger default box.
  return (
    <img
      src={src} alt=""
      style={{ maxHeight: height, maxWidth, width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', marginBottom: 6, ...style }}
    />
  );
}
