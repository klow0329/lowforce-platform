const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

// Turns a plain-text password into a scrambled hash before it's ever
// stored. Nobody — not even someone with direct database access — can
// read the original password back out of this.
async function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

// Checks a login attempt's password against the stored hash.
async function verifyPassword(plainTextPassword, storedHash) {
  return bcrypt.compare(plainTextPassword, storedHash);
}

module.exports = { hashPassword, verifyPassword };
