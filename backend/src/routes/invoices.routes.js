const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const { listInvoices, getInvoice, generateDraftInvoices, issueScheduledInvoice, updateInvoice, withdrawInvoice, acknowledgeConfirm } = require('../controllers/invoices.controller');
const {
  listAttachments, uploadAttachment, downloadAttachment, deleteAttachment, acknowledgePaymentProof, upload,
} = require('../controllers/invoiceAttachments.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listInvoices));
router.post('/generate-draft', asyncHandler(generateDraftInvoices));
router.get('/:id', asyncHandler(getInvoice));
router.put('/:id', asyncHandler(updateInvoice));
router.delete('/:id', asyncHandler(withdrawInvoice));
router.post('/:id/acknowledge', asyncHandler(acknowledgeConfirm));
router.post('/:id/issue', asyncHandler(issueScheduledInvoice));

router.get('/:id/attachments', asyncHandler(listAttachments));
router.post('/:id/attachments', upload.single('file'), asyncHandler(uploadAttachment));
router.get('/:id/attachments/:attachmentId/download', asyncHandler(downloadAttachment));
router.delete('/:id/attachments/:attachmentId', asyncHandler(deleteAttachment));
router.post('/:id/attachments/:attachmentId/acknowledge', asyncHandler(acknowledgePaymentProof));

module.exports = router;
