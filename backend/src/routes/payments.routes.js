const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listPayments, getPayment, createPayment, addAllocation, deleteAllocation, updatePayment, deletePayment, acknowledgeAllocation,
} = require('../controllers/payments.controller');

router.use(attachTenant);

router.get('/', asyncHandler(listPayments));
router.post('/', asyncHandler(createPayment));
router.get('/:id', asyncHandler(getPayment));
router.put('/:id', asyncHandler(updatePayment));
router.delete('/:id', asyncHandler(deletePayment));
router.post('/:id/allocations', asyncHandler(addAllocation));
router.delete('/:id/allocations/:allocationId', asyncHandler(deleteAllocation));
router.post('/allocations/:allocationId/acknowledge', asyncHandler(acknowledgeAllocation));

module.exports = router;
