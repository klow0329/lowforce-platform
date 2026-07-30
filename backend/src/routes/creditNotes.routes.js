const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { blockManagementWrites } = require('../middleware/blockManagementWrites');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listCreditNotes, getCreditNote, requestCreditNote, updateCreditNote, deleteCreditNote,
  approveCreditNote, rejectCreditNote, confirmCreditNote, acknowledgeCnConfirm,
} = require('../controllers/creditNotes.controller');
const {
  listAttachments, uploadAttachment, downloadAttachment, deleteAttachment, upload,
} = require('../controllers/creditNoteAttachments.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listCreditNotes));
router.post('/', blockManagementWrites, asyncHandler(requestCreditNote));
router.get('/:id', asyncHandler(getCreditNote));
router.put('/:id', blockManagementWrites, asyncHandler(updateCreditNote));
router.delete('/:id', blockManagementWrites, asyncHandler(deleteCreditNote));
// Approve/Reject are NOT gated by blockManagementWrites — same reasoning as
// contract approval: approving is a legitimate Management (or tiered
// approver) action, not a "write" in the edit-the-record sense.
router.put('/:id/approve', asyncHandler(approveCreditNote));
router.put('/:id/reject', asyncHandler(rejectCreditNote));
router.put('/:id/confirm', asyncHandler(confirmCreditNote));
router.post('/:id/acknowledge', asyncHandler(acknowledgeCnConfirm));

router.get('/:id/attachments', asyncHandler(listAttachments));
router.post('/:id/attachments', upload.single('file'), asyncHandler(uploadAttachment));
router.get('/:id/attachments/:attachmentId/download', asyncHandler(downloadAttachment));
router.delete('/:id/attachments/:attachmentId', asyncHandler(deleteAttachment));

module.exports = router;
