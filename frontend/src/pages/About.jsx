// Platform identity page — this is about LowForce the product (fixed for
// every tenant), not any one company's own branding (see CompanyBranding.jsx
// for that). Reachable from the LowForce logo in the top-right of the nav bar.
const PLATFORM_VERSION = 'v1.0.0';

export default function About() {
  return (
    <div className="page" style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center' }}>
      <img src="/lowforce-logo.png" alt="LowForce" style={{ width: 220, maxWidth: '100%', marginBottom: 8 }} />
      <div style={{ fontSize: 13, color: '#5c6070', marginBottom: 24 }}>{PLATFORM_VERSION}</div>

      <h2 style={{ marginBottom: 4 }}>Events accelerated</h2>
      <p style={{ color: '#5c6070', marginBottom: 32 }}>
        LowForce Platform — powering events for enterprise organizations.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <a href="https://lowforce.co/docs" target="_blank" rel="noopener noreferrer">Documentation</a>
        <a href="mailto:support@lowforce.co">Contact Support</a>
        <a href="https://lowforce.co" target="_blank" rel="noopener noreferrer">lowforce.co</a>
      </div>
    </div>
  );
}
