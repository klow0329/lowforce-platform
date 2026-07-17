const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const { listPayments, getPayment, createPayment, updatePayment } = require('../controllers/payments.controller');

router.use(attachTenant);

router.get('/', asyncHandler(listPayments));
router.post('/', asyncHandler(createPayment));
router.get('/:id', asyncHandler(getPayment));
router.put('/:id', asyncHandler(updatePayment));

module.exports = router;
