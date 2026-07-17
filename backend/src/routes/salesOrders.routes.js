const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listSalesOrders,
  getSalesOrder,
  createSalesOrder,
  updateSalesOrder,
} = require('../controllers/salesOrders.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listSalesOrders));
router.post('/', asyncHandler(createSalesOrder));
router.get('/:id', asyncHandler(getSalesOrder));
router.put('/:id', asyncHandler(updateSalesOrder));

module.exports = router;
