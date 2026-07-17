const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const { listPriceList, createPriceItem, updatePriceItem, deletePriceItem } = require('../controllers/priceList.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listPriceList));
// Prices are company configuration — only admins change them
router.post('/', requireAdmin, asyncHandler(createPriceItem));
router.put('/:id', requireAdmin, asyncHandler(updatePriceItem));
router.delete('/:id', requireAdmin, asyncHandler(deletePriceItem));

module.exports = router;
