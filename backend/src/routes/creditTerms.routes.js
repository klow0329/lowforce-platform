const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listCreditTerms, createCreditTerm, updateCreditTerm, deleteCreditTerm, resolveCreditTermForContract,
} = require('../controllers/creditTerms.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/', asyncHandler(listCreditTerms));
// Credit terms are company configuration — only admins change them
router.post('/', requireAdmin, asyncHandler(createCreditTerm));
router.put('/:id', requireAdmin, asyncHandler(updateCreditTerm));
router.delete('/:id', requireAdmin, asyncHandler(deleteCreditTerm));
router.get('/resolve/:salesOrderId', asyncHandler(resolveCreditTermForContract));

module.exports = router;
