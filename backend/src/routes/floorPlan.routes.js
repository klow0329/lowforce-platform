const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { blockManagementWrites } = require('../middleware/blockManagementWrites');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  upload,
  listHalls, createHall, deleteHall, uploadHallImage, getHallImage,
  listBooths, createBooth, bulkGenerateBooths, autoDetectBooths, updateBooth, bulkUpdateBooths, deleteBooth,
} = require('../controllers/floorPlan.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/halls', asyncHandler(listHalls));
router.post('/halls', blockManagementWrites, asyncHandler(createHall));
router.delete('/halls/:id', blockManagementWrites, asyncHandler(deleteHall));
router.post('/halls/:id/image', blockManagementWrites, upload.single('image'), asyncHandler(uploadHallImage));
router.get('/halls/:id/image', asyncHandler(getHallImage));

router.get('/halls/:id/booths', asyncHandler(listBooths));
router.post('/halls/:id/booths', blockManagementWrites, asyncHandler(createBooth));
router.post('/halls/:id/booths/bulk-generate', blockManagementWrites, asyncHandler(bulkGenerateBooths));
router.post('/halls/:id/booths/auto-detect', blockManagementWrites, asyncHandler(autoDetectBooths));
// bulk-update must be registered BEFORE :boothId — otherwise Express
// matches the wildcard param route first, treating "bulk-update" as a
// literal (nonexistent) booth id: updateBooth then silently no-ops (200,
// zero rows touched) instead of ever reaching bulkUpdateBooths. This is
// exactly what caused Bulk Edit's "Apply" to appear to succeed while
// leaving every selected booth unchanged.
router.put('/halls/:id/booths/bulk-update', blockManagementWrites, asyncHandler(bulkUpdateBooths));
router.put('/halls/:id/booths/:boothId', blockManagementWrites, asyncHandler(updateBooth));
router.delete('/halls/:id/booths/:boothId', blockManagementWrites, asyncHandler(deleteBooth));

module.exports = router;
