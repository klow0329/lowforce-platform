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

// Without this handler, an error on an idle connection (e.g. the database
// restarting) is an unhandled 'error' event and crashes the whole server.
// Log it instead — in-flight queries still fail cleanly and get retried by
// the user, and the pool reconnects on the next query.
pool.on('error', (err) => {
  console.error('Idle database connection error (server stays up):', err.message);
});

module.exports = { pool };
