const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const { listEntries, addEntry, updateEntry } = require('../controllers/correspondence.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listEntries));
router.post('/', asyncHandler(addEntry));
router.put('/:id', asyncHandler(updateEntry));

module.exports = router;
