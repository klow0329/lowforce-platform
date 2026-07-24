import { api } from '../api/client';

// Falls back to the built-in ExpoCO logo when a company hasn't uploaded its
// own — so a freshly onboarded company still prints something sensible
// rather than a broken image, until they set it up in Admin > Company Profile.
export function BrandLogo({ company, height = 44, style }) {
  const src = company?.has_logo ? api.brandingImageUrl('logo') : '/logo.png';
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
