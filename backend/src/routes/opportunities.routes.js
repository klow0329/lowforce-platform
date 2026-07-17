const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listOpportunities,
  getOpportunitySummary,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
} = require('../controllers/opportunities.controller');

router.use(attachTenant); // every route below this line requires login + gets req.companyId
router.use(requireEventAccess); // and can't touch an event the user hasn't been granted

router.get('/summary', asyncHandler(getOpportunitySummary)); // before /:id so "summary" isn't read as an id
router.get('/', asyncHandler(listOpportunities));
router.post('/', asyncHandler(createOpportunity));
router.get('/:id', asyncHandler(getOpportunity));
router.put('/:id', asyncHandler(updateOpportunity));

module.exports = router;
