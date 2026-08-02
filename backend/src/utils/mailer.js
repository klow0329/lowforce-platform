// Outbound transactional email — SMTP config comes entirely from
// environment variables (never hardcoded), so this works for any company's
// own mail account, not just noreply@lowforce.co. If the env vars aren't
// set (e.g. local dev), sendMail() logs a warning and returns without
// throwing, so the rest of the app keeps working without email configured.
const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    // Without these, a blocked/filtered outbound connection (common on
    // PaaS hosts — some restrict or throttle port 587/465 egress) hangs
    // the request indefinitely instead of failing with a diagnosable
    // error. 15s is generous for a real SMTP handshake.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
  return transporter;
}

function isMailConfigured() {
  return getTransporter() !== null;
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
// { sent: true } on success or { sent: false, reason } if unconfigured —
// callers should surface `reason` to the admin who triggered the action
// rather than silently pretending it went out.
async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.warn(`[mailer] SMTP not configured — email to ${to} ("${subject}") was not sent.`);
    return { sent: false, reason: 'Email is not configured on this server yet (SMTP_HOST/PORT/USER/PASSWORD).' };
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'LowForce Platform';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER;
  await t.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text: text ? `${text}${AUTOMATED_FOOTER_TEXT}` : undefined,
    html: html ? `${html}${AUTOMATED_FOOTER_HTML}` : undefined,
  });
  return { sent: true };
}

module.exports = { sendMail, isMailConfigured };
