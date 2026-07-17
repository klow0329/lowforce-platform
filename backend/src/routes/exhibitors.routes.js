const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const { listExhibitors, getExhibitor, createExhibitor, updateExhibitor } = require('../controllers/exhibitors.controller');

router.use(attachTenant); // every route below this line requires login + gets req.companyId

router.get('/', asyncHandler(listExhibitors));
router.post('/', asyncHandler(createExhibitor));
router.get('/:id', asyncHandler(getExhibitor));
router.put('/:id', asyncHandler(updateExhibitor));

module.exports = router;
