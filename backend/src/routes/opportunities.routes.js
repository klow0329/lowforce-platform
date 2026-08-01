const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { blockManagementWrites } = require('../middleware/blockManagementWrites');
const { requireModulePermission } = require('../middleware/modulePermission');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listOpportunities,
  getOpportunitySummary,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
} = require('../controllers/opportunities.controller');
const {
  listItems,
  addItem,
  updateItem,
  deleteItem,
} = require('../controllers/opportunityItems.controller');
const { listRecordBooths, bulkSetRecordBooths, acknowledgeBoothLoss } = require('../controllers/floorPlan.controller');

router.use(attachTenant); // every route below this line requires login + gets req.companyId
router.use(requireEventAccess); // and can't touch an event the user hasn't been granted

router.get('/summary', asyncHandler(getOpportunitySummary)); // before /:id so "summary" isn't read as an id
router.get('/', asyncHandler(listOpportunities));
router.post('/', blockManagementWrites, requireModulePermission('opportunities', 'add'), asyncHandler(createOpportunity));
router.get('/:id', asyncHandler(getOpportunity));
router.put('/:id', blockManagementWrites, requireModulePermission('opportunities', 'edit'), asyncHandler(updateOpportunity));

router.get('/:id/items', asyncHandler(listItems));
router.post('/:id/items', blockManagementWrites, asyncHandler(addItem));
router.put('/:id/items/:itemId', blockManagementWrites, asyncHandler(updateItem));
router.delete('/:id/items/:itemId', blockManagementWrites, asyncHandler(deleteItem));

// Multi-booth support — see floorPlan.controller.js's listRecordBooths/
// bulkSetRecordBooths. GET lists the current set (feeds the live Hall/Booth
// No display and pre-selects the Floor Plan's sqm-capped picker); PUT
// replaces the entire set in one shot, straight from that picker's "OK".
router.get('/:id/booths', asyncHandler(listRecordBooths('opportunity')));
router.put('/:id/booths', blockManagementWrites, asyncHandler(bulkSetRecordBooths('opportunity', 'opportunities', 'opportunity_id')));
router.post('/:id/acknowledge-booth-loss', asyncHandler(acknowledgeBoothLoss('opportunity')));

module.exports = router;
