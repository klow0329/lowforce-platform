const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { blockManagementWrites } = require('../middleware/blockManagementWrites');
const { requireModulePermission } = require('../middleware/modulePermission');
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
  submitForApproval,
  withdrawApproval,
  approveSalesOrder,
  rejectSalesOrder,
  voidSalesOrder,
  acknowledgeApproval,
} = require('../controllers/approvals.controller');
const { listRecordBooths, bulkSetRecordBooths, acknowledgeBoothLoss } = require('../controllers/floorPlan.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listSalesOrders));
router.post('/', blockManagementWrites, requireModulePermission('contracts', 'add'), asyncHandler(createSalesOrder));
router.get('/:id', asyncHandler(getSalesOrder));
router.put('/:id', blockManagementWrites, requireModulePermission('contracts', 'edit'), asyncHandler(updateSalesOrder));

router.get('/:id/items', asyncHandler(listItems));
router.post('/:id/items', blockManagementWrites, asyncHandler(addItem));
router.put('/:id/items/:itemId', blockManagementWrites, asyncHandler(updateItem));
router.delete('/:id/items/:itemId', blockManagementWrites, asyncHandler(deleteItem));

router.get('/:id/attachments', asyncHandler(listAttachments));
router.post('/:id/attachments', blockManagementWrites, upload.single('file'), asyncHandler(uploadAttachment));
router.get('/:id/attachments/:attachmentId/download', asyncHandler(downloadAttachment));
router.delete('/:id/attachments/:attachmentId', blockManagementWrites, asyncHandler(deleteAttachment));

// Approve/Reject/Submit-for-approval are NOT gated by blockManagementWrites
// — approving is Management's actual job here (approveSalesOrder/
// rejectSalesOrder already require isElevated, which still includes MGT).
router.get('/:id/approval-log', asyncHandler(listApprovalLog));
router.post('/:id/submit-for-approval', asyncHandler(submitForApproval));
router.post('/:id/withdraw-approval', asyncHandler(withdrawApproval));
router.post('/:id/approve', asyncHandler(approveSalesOrder));
router.post('/:id/reject', asyncHandler(rejectSalesOrder));
router.post('/:id/void', blockManagementWrites, asyncHandler(voidSalesOrder));
router.post('/:id/acknowledge', asyncHandler(acknowledgeApproval));

// Multi-booth support — see floorPlan.controller.js's listRecordBooths/
// bulkSetRecordBooths. GET lists the current set (feeds the live Hall/Booth
// No display and pre-selects the Floor Plan's sqm-capped picker); PUT
// replaces the entire set in one shot, straight from that picker's "OK".
router.get('/:id/booths', asyncHandler(listRecordBooths('sales_order')));
router.put('/:id/booths', blockManagementWrites, asyncHandler(bulkSetRecordBooths('sales_order', 'sales_orders', 'sales_order_id')));
router.post('/:id/acknowledge-booth-loss', asyncHandler(acknowledgeBoothLoss('sales_order')));

module.exports = router;
