import { api } from '../api/client';

// Renders nothing until the tenant uploads their own — this slot is their
// identity specifically, so it should never show a placeholder (LowForce's
// own mark lives in its own dedicated nav-bar spot, not here) or another
// real customer's leftover branding. Matches the same "render nothing until
// set" convention LetterheadBand/FooterBand/EventBrandLogo already use.
export function BrandLogo({ company, height = 44, style }) {
  if (!company?.has_logo) return null;
  return <img src={api.brandingImageUrl('logo')} alt="" style={{ height, display: 'block', marginBottom: 6, ...style }} />;
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
export function EventBrandLogo({ company, height = 44, style }) {
  if (!company?.has_event_logo) return null;
  const src = company.main_event_id ? api.eventLogoUrl(company.main_event_id) : api.brandingImageUrl('event_logo');
  return <img src={src} alt="" style={{ height, display: 'block', marginBottom: 6, ...style }} />;
}
