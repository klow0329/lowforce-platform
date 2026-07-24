const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { blockManagementWrites } = require('../middleware/blockManagementWrites');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listCreditNotes, getCreditNote, requestCreditNote, approveCreditNote, rejectCreditNote, confirmCreditNote,
} = require('../controllers/creditNotes.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listCreditNotes));
router.post('/', blockManagementWrites, asyncHandler(requestCreditNote));
router.get('/:id', asyncHandler(getCreditNote));
// Approve/Reject are NOT gated by blockManagementWrites — same reasoning as
// contract approval: approving is a legitimate Management (or tiered
// approver) action, not a "write" in the edit-the-record sense.
router.put('/:id/approve', asyncHandler(approveCreditNote));
router.put('/:id/reject', asyncHandler(rejectCreditNote));
router.put('/:id/confirm', asyncHandler(confirmCreditNote));

module.exports = router;
