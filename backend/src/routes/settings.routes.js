const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listTaxCodes, createTaxCode, updateTaxCode,
  listExpenseCodes, createExpenseCode, updateExpenseCode, importExpenseCodes,
  listAgentsAdmin, createAgent, updateAgent, importAgents,
  listAgentCommissionRates, saveAgentCommissionRates,
  listAgentCommissionBonusTiers, saveAgentCommissionBonusTiers,
  createSegmentMain, updateSegmentMain, deleteSegmentMain,
  createSegmentSub, updateSegmentSub, deleteSegmentSub, importSegments,
  getSettings, updateSettings,
  uploadBranding, uploadBrandingImage, getBrandingImage, deleteBrandingImage,
} = require('../controllers/settings.controller');

router.use(attachTenant);

router.get('/branding/:type', asyncHandler(getBrandingImage)); // everyone can view (print pages)
router.post('/branding/:type', requireAdmin, uploadBranding.single('image'), asyncHandler(uploadBrandingImage));
router.delete('/branding/:type', requireAdmin, asyncHandler(deleteBrandingImage));

router.get('/tax-codes', asyncHandler(listTaxCodes)); // everyone can read (needed for line-item dropdowns)
router.post('/tax-codes', requireAdmin, asyncHandler(createTaxCode));
router.put('/tax-codes/:id', requireAdmin, asyncHandler(updateTaxCode));

router.get('/expense-codes', asyncHandler(listExpenseCodes)); // everyone can read (needed for Budget line dropdowns)
router.post('/expense-codes', requireAdmin, asyncHandler(createExpenseCode));
router.put('/expense-codes/:id', requireAdmin, asyncHandler(updateExpenseCode));
router.post('/expense-codes/import', requireAdmin, asyncHandler(importExpenseCodes));

router.get('/agents', asyncHandler(listAgentsAdmin)); // everyone can read (needed by the exhibitor Agent picker)
router.post('/agents', requireAdmin, asyncHandler(createAgent));
router.post('/agents/import', requireAdmin, asyncHandler(importAgents));
// Editing an agent's own details is open to Admin plus whichever salesperson
// is that agent's assigned owner (ag.salesperson_id) — see updateAgent's own
// ownership check — everyone else stays read-only.
router.put('/agents/:id', asyncHandler(updateAgent));
// Commission rates: readable by everyone (same as the agent record itself),
// writes gated inside saveAgentCommissionRates by the same ownership rule.
router.get('/agents/:agentId/commission-rates', asyncHandler(listAgentCommissionRates));
router.put('/agents/:agentId/commission-rates', asyncHandler(saveAgentCommissionRates));
router.get('/agents/:agentId/commission-bonus-tiers', asyncHandler(listAgentCommissionBonusTiers));
router.put('/agents/:agentId/commission-bonus-tiers', asyncHandler(saveAgentCommissionBonusTiers));

// Reads live under /api/reference/segments (open to everyone — needed by
// exhibitor forms); these are the Admin-only writes.
router.post('/segments/main', requireAdmin, asyncHandler(createSegmentMain));
router.put('/segments/main/:id', requireAdmin, asyncHandler(updateSegmentMain));
router.delete('/segments/main/:id', requireAdmin, asyncHandler(deleteSegmentMain));
router.post('/segments/sub', requireAdmin, asyncHandler(createSegmentSub));
router.put('/segments/sub/:id', requireAdmin, asyncHandler(updateSegmentSub));
router.delete('/segments/sub/:id', requireAdmin, asyncHandler(deleteSegmentSub));
router.post('/segments/import', requireAdmin, asyncHandler(importSegments));

router.get('/', asyncHandler(getSettings));
router.put('/', requireAdmin, asyncHandler(updateSettings));

module.exports = router;
