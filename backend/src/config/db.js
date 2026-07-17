const { Pool, types } = require('pg');

// By default node-postgres parses DATE columns into JS Date objects at
// local midnight, which then serialize to JSON as UTC — shifting the
// calendar date by a day for any timezone ahead of UTC (e.g. MYT/UTC+8).
// We only ever want the plain 'YYYY-MM-DD' the database already stores.
types.setTypeParser(types.builtins.DATE, (val) => val);

// One shared connection pool for the whole app. Every query below goes
// through this pool; nothing connects directly.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = { pool };
