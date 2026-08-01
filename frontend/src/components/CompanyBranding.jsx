import { api } from '../api/client';

// Falls back to the neutral LowForce placeholder when a tenant hasn't
// uploaded their own — so a freshly onboarded company still prints
// something sensible rather than a broken image (or worse, another real
// customer's branding) until they set it up in Admin > Company Profile.
export function BrandLogo({ company, height = 44, style }) {
  const src = company?.has_logo ? api.brandingImageUrl('logo') : '/default-logo.svg';
  return <img src={src} alt="" style={{ height, display: 'block', marginBottom: 6, ...style }} />;
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
export function EventBrandLogo({ company, height = 44, style }) {
  if (!company?.has_event_logo) return null;
  return <img src={api.brandingImageUrl('event_logo')} alt="" style={{ height, display: 'block', marginBottom: 6, ...style }} />;
}
