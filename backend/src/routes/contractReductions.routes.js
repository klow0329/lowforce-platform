const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { blockManagementWrites } = require('../middleware/blockManagementWrites');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listContractReductions, getContractReduction, requestContractReduction, updateContractReduction, deleteContractReduction,
  approveContractReduction, rejectContractReduction, issueContractReductionCn,
} = require('../controllers/contractReductions.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listContractReductions));
router.post('/', blockManagementWrites, asyncHandler(requestContractReduction));
router.get('/:id', asyncHandler(getContractReduction));
router.put('/:id', blockManagementWrites, asyncHandler(updateContractReduction));
router.delete('/:id', blockManagementWrites, asyncHandler(deleteContractReduction));
// Approve/Reject are NOT gated by blockManagementWrites — same reasoning as
// contract/CN approval: approving is a legitimate tiered-approver action,
// not a "write" in the edit-the-record sense.
router.put('/:id/approve', asyncHandler(approveContractReduction));
router.put('/:id/reject', asyncHandler(rejectContractReduction));
// Issuing the pre-approved shortfall CN is a normal Sales write, same gate
// as everything else that edits the contract.
router.post('/:id/issue-cn', blockManagementWrites, asyncHandler(issueContractReductionCn));

module.exports = router;
