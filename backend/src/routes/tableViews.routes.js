const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const { listViews, createView, updateView, deleteView } = require('../controllers/tableViews.controller');

router.use(attachTenant); // just needs req.userId — no tenant scoping on the table itself

router.get('/', asyncHandler(listViews));
router.post('/', asyncHandler(createView));
router.put('/:id', asyncHandler(updateView));
router.delete('/:id', asyncHandler(deleteView));

module.exports = router;
