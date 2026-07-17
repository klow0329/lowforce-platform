const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const { listInvoices, getInvoice, createInvoice, updateInvoice } = require('../controllers/invoices.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listInvoices));
router.post('/', asyncHandler(createInvoice));
router.get('/:id', asyncHandler(getInvoice));
router.put('/:id', asyncHandler(updateInvoice));

module.exports = router;
