const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const { listAuditLog } = require('../controllers/audit.controller');

router.use(attachTenant);
router.use(requireAdmin);

router.get('/log', asyncHandler(listAuditLog));

module.exports = router;
