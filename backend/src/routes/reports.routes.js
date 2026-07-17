const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const { getCustomerAging, getDashboard } = require('../controllers/reports.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/customer-aging', asyncHandler(getCustomerAging));
router.get('/dashboard', asyncHandler(getDashboard));

module.exports = router;
