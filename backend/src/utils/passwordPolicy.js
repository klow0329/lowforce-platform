const crypto = require('crypto');

// Applies everywhere a password is SET, by a person or by the system:
// tenant self-service change, tenant Admin resetting a user, platform admin
// self-service change, and the temp passwords the platform console
// generates (createCompanyAdmin, resetCompanyUserPassword) — those must
// satisfy this too, or a freshly-generated login would fail its own policy
// the moment someone tried to change it. 8 chars was already the standing
// minimum; this adds the complexity requirement on top of it.
function passwordPolicyError(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a special character (e.g. ! @ # $).';
  return null;
}

// Deterministically satisfies the policy rather than hoping randomness
// happens to — the previous generator (random base64 + a fixed "!1" suffix)
// guaranteed a digit and a symbol but not both letter cases.
function generateStrongPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — avoids look-alike confusion
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%';
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const base = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 8);
  return base + pick(upper) + pick(lower) + pick(digits) + pick(special);
}

module.exports = { passwordPolicyError, generateStrongPassword };
