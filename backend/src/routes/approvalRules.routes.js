const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const { listRules, createRule, updateRule, deleteRule } = require('../controllers/approvals.controller');

router.use(attachTenant);
router.use(requireAdmin);

router.get('/', asyncHandler(listRules));
router.post('/', asyncHandler(createRule));
router.put('/:id', asyncHandler(updateRule));
router.delete('/:id', asyncHandler(deleteRule));

module.exports = router;
