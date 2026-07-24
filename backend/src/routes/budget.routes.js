const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  getBudget, createBudget,
  addBudgetLine, updateBudgetLine, deleteBudgetLine,
  submitBudgetForApproval, approveBudget, rejectBudget,
  listActualExpenseEntries, createActualExpenseEntry, updateActualExpenseEntry,
} = require('../controllers/budget.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(getBudget));
router.post('/', asyncHandler(createBudget));
router.post('/:id/lines', asyncHandler(addBudgetLine));
router.put('/:id/lines/:lineId', asyncHandler(updateBudgetLine));
router.delete('/:id/lines/:lineId', asyncHandler(deleteBudgetLine));
router.post('/:id/submit-for-approval', asyncHandler(submitBudgetForApproval));
router.post('/:id/approve', asyncHandler(approveBudget));
router.post('/:id/reject', asyncHandler(rejectBudget));

router.get('/actual-expenses', asyncHandler(listActualExpenseEntries));
router.post('/actual-expenses', asyncHandler(createActualExpenseEntry));
router.put('/actual-expenses/:id', asyncHandler(updateActualExpenseEntry));

module.exports = router;
