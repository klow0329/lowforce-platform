const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { requireModulePermission } = require('../middleware/modulePermission');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listExhibitors, getExhibitor, createExhibitor, updateExhibitor, importRepeatExhibitors, importExhibitors,
} = require('../controllers/exhibitors.controller');

router.use(attachTenant); // every route below this line requires login + gets req.companyId

router.get('/', asyncHandler(listExhibitors));
router.post('/', requireModulePermission('exhibitors', 'add'), asyncHandler(createExhibitor));
router.post('/import-repeat-list', requireAdmin, asyncHandler(importRepeatExhibitors));
router.post('/import', requireAdmin, asyncHandler(importExhibitors));
router.get('/:id', asyncHandler(getExhibitor));
router.put('/:id', requireModulePermission('exhibitors', 'edit'), asyncHandler(updateExhibitor));

module.exports = router;
