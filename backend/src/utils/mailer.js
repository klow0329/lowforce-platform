// Outbound transactional email via Resend's HTTP API — not SMTP. Gmail SMTP
// (the original design) turned out to hang/timeout on Railway: consumer
// Gmail's SMTP servers routinely block or silently drop connections from
// cloud/datacenter IPs as an anti-spam measure, which is a network-level
// problem no amount of app-side config can fix. An HTTP API sidesteps that
// entirely — no SMTP port, no port-blocking, no "is this IP a spam source"
// heuristic against a residential mail server.
// RESEND_API_KEY comes from the environment only (never hardcoded), so this
// isn't tied to one specific account.
const { Resend } = require('resend');

let client = null;
function getClient() {
  if (client) return client;
  const { RESEND_API_KEY } = process.env;
  if (!RESEND_API_KEY) return null;
  client = new Resend(RESEND_API_KEY);
  return client;
}

function isMailConfigured() {
  return getClient() !== null;
}

// Every automated email gets the same "don't reply to this" footer,
// pointing at a real support address instead — standing requirement so
// nobody replies to a mailbox no one reads.
const AUTOMATED_FOOTER_TEXT = '\n\n---\nThis is an automated message from LowForce Platform. Please do not reply to this email — for help, contact support@lowforce.co.';
const AUTOMATED_FOOTER_HTML = '<hr style="margin-top:24px;border:none;border-top:1px solid #e2e5ec;">'
  + '<p style="font-size:12px;color:#8b90a0;">This is an automated message from LowForce Platform. '
  + 'Please do not reply to this email — for help, contact '
  + '<a href="mailto:support@lowforce.co">support@lowforce.co</a>.</p>';

// `text`/`html` are the message body only — the automated-sender footer is
// appended here so every call site gets it automatically. Returns
// { sent: true } on success or { sent: false, reason } if unconfigured or
// rejected by Resend — callers should surface `reason` to the admin who
// triggered the action rather than silently pretending it went out.
async function sendMail({ to, subject, text, html }) {
  const c = getClient();
  if (!c) {
    console.warn(`[mailer] RESEND_API_KEY not set — email to ${to} ("${subject}") was not sent.`);
    return { sent: false, reason: 'Email is not configured on this server yet (RESEND_API_KEY).' };
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'LowForce Platform';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@lowforce.co';
  const { data, error } = await c.emails.send({
    from: `${fromName} <${fromAddress}>`,
    to,
    subject,
    text: text ? `${text}${AUTOMATED_FOOTER_TEXT}` : undefined,
    html: html ? `${html}${AUTOMATED_FOOTER_HTML}` : undefined,
  });
  if (error) {
    console.warn(`[mailer] Resend rejected email to ${to} ("${subject}"): ${error.message}`);
    return { sent: false, reason: error.message };
  }
  return { sent: true, id: data?.id };
}

module.exports = { sendMail, isMailConfigured };
