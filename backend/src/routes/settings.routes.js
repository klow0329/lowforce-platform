const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listTaxCodes, createTaxCode, updateTaxCode,
  listExpenseCodes, createExpenseCode, updateExpenseCode,
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

router.get('/', asyncHandler(getSettings));
router.put('/', requireAdmin, asyncHandler(updateSettings));

module.exports = router;
