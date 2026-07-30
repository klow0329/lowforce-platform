const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const { listExhibitors, getExhibitor, createExhibitor, updateExhibitor, importRepeatExhibitors } = require('../controllers/exhibitors.controller');

router.use(attachTenant); // every route below this line requires login + gets req.companyId

router.get('/', asyncHandler(listExhibitors));
router.post('/', asyncHandler(createExhibitor));
router.post('/import-repeat-list', requireAdmin, asyncHandler(importRepeatExhibitors));
router.get('/:id', asyncHandler(getExhibitor));
router.put('/:id', asyncHandler(updateExhibitor));

module.exports = router;
