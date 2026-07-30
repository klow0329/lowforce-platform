const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const { listTemplates, getTemplate, updateTemplate } = require('../controllers/emailTemplates.controller');

router.use(attachTenant);

router.get('/', asyncHandler(listTemplates));
router.get('/:key', asyncHandler(getTemplate));
router.put('/:key', asyncHandler(updateTemplate));

module.exports = router;
