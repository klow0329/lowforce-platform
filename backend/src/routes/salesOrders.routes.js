const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listSalesOrders,
  getSalesOrder,
  createSalesOrder,
  updateSalesOrder,
} = require('../controllers/salesOrders.controller');
const {
  listItems,
  addItem,
  updateItem,
  deleteItem,
} = require('../controllers/salesOrderItems.controller');
const {
  listAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  upload,
} = require('../controllers/salesOrderAttachments.controller');
const {
  listApprovalLog,
  approveSalesOrder,
  rejectSalesOrder,
} = require('../controllers/approvals.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listSalesOrders));
router.post('/', asyncHandler(createSalesOrder));
router.get('/:id', asyncHandler(getSalesOrder));
router.put('/:id', asyncHandler(updateSalesOrder));

router.get('/:id/items', asyncHandler(listItems));
router.post('/:id/items', asyncHandler(addItem));
router.put('/:id/items/:itemId', asyncHandler(updateItem));
router.delete('/:id/items/:itemId', asyncHandler(deleteItem));

router.get('/:id/attachments', asyncHandler(listAttachments));
router.post('/:id/attachments', upload.single('file'), asyncHandler(uploadAttachment));
router.get('/:id/attachments/:attachmentId/download', asyncHandler(downloadAttachment));
router.delete('/:id/attachments/:attachmentId', asyncHandler(deleteAttachment));

router.get('/:id/approval-log', asyncHandler(listApprovalLog));
router.post('/:id/approve', asyncHandler(approveSalesOrder));
router.post('/:id/reject', asyncHandler(rejectSalesOrder));

module.exports = router;
