const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const { listTaxCodes, createTaxCode, updateTaxCode, getSettings, updateSettings } = require('../controllers/settings.controller');

router.use(attachTenant);

router.get('/tax-codes', asyncHandler(listTaxCodes)); // everyone can read (needed for line-item dropdowns)
router.post('/tax-codes', requireAdmin, asyncHandler(createTaxCode));
router.put('/tax-codes/:id', requireAdmin, asyncHandler(updateTaxCode));

router.get('/', asyncHandler(getSettings));
router.put('/', requireAdmin, asyncHandler(updateSettings));

module.exports = router;
