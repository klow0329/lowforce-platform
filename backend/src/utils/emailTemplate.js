// Shared {{placeholder}} substitution for outbound email — used everywhere
// a company-customizable template (email_templates table) or a built-in
// fallback gets filled with real values before sending. An unmatched
// placeholder is left as-is rather than blanked, so a typo in a saved
// template is obviously visible instead of silently disappearing.
function fillTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m));
}

// Built-in fallback wording for the two password-reset emails — unlike
// USER_INVITE (a nice-to-have the company can fully skip), these must work
// the moment a company exists, since a locked-out Admin's own recovery
// path can't depend on someone having remembered to set up a template
// first. A company CAN still override either via Admin > Email Templates
// (PASSWORD_RESET / FORGOT_PASSWORD keys) — this is only what's used when
// they haven't.
const DEFAULT_PASSWORD_RESET_SUBJECT = 'Your {{company_name}} password has been reset';
const DEFAULT_PASSWORD_RESET_BODY = `Hi {{full_name}},

An administrator at {{company_name}} has reset your LowForce password.

Temporary password: {{temp_password}}

Please log in and change it as soon as possible.`;

const DEFAULT_FORGOT_PASSWORD_SUBJECT = 'Reset your {{company_name}} password';
const DEFAULT_FORGOT_PASSWORD_BODY = `Hi {{full_name}},

Someone (hopefully you) requested a password reset for your LowForce account at {{company_name}}.

Reset your password: {{reset_url}}

This link expires in {{expires_minutes}} minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password will not change.`;

module.exports = {
  fillTemplate,
  DEFAULT_PASSWORD_RESET_SUBJECT, DEFAULT_PASSWORD_RESET_BODY,
  DEFAULT_FORGOT_PASSWORD_SUBJECT, DEFAULT_FORGOT_PASSWORD_BODY,
};
