const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const { createLink, getLinkInfo, submitLink } = require('../controllers/taxDetailLinks.controller');

// Generating a link is an authenticated, in-app action.
router.post('/create', attachTenant, asyncHandler(createLink));

// The link itself is PUBLIC — no login, no tenant middleware. Security is
// the token (long, random, single-use, time-limited), not a session — see
// taxDetailLinks.controller.js.
router.get('/:token', asyncHandler(getLinkInfo));
router.post('/:token', asyncHandler(submitLink));

module.exports = router;
