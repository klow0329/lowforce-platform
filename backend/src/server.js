require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { pool } = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const exhibitorsRoutes = require('./routes/exhibitors.routes');
const referenceRoutes = require('./routes/reference.routes');
const opportunitiesRoutes = require('./routes/opportunities.routes');
const salesOrdersRoutes = require('./routes/salesOrders.routes');
const invoicesRoutes = require('./routes/invoices.routes');
const paymentsRoutes = require('./routes/payments.routes');
const reportsRoutes = require('./routes/reports.routes');
const adminRoutes = require('./routes/admin.routes');
const priceListRoutes = require('./routes/priceList.routes');

const app = express();

// When this sits behind a reverse proxy / hosting platform later (Railway,
// Render, nginx on a real domain), this makes Express trust the proxy's
// HTTPS headers so secure cookies work.
app.set('trust proxy', 1);

app.use(express.json());

app.use(session({
  // Sessions live in Postgres, not process memory — server restarts no
  // longer log everyone out. (The table is auto-created on first run.)
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,               // JavaScript in the browser can't read the cookie
    secure: process.env.NODE_ENV === 'production', // HTTPS-only once deployed behind a real domain
    maxAge: 1000 * 60 * 60 * 8,   // 8-hour session
  },
}));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/exhibitors', exhibitorsRoutes);
app.use('/api/reference', referenceRoutes);
app.use('/api/opportunities', opportunitiesRoutes);
app.use('/api/sales-orders', salesOrdersRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/price-list', priceListRoutes);

// If the frontend has been built (npm run build in frontend/), serve it from
// this same server — one port, one URL to share. During development the Vite
// dev server on :5173 still works exactly as before; this only kicks in for
// the built copy.
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Basic error handler so a thrown error doesn't crash the whole server
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LowForce API running on http://localhost:${PORT}`);
});
