const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const {
  platformLogin, platformMe, platformLogout,
  listGroups, createGroup, updateGroup,
  listCompanies, createCompany, updateCompany, setCompanySuspension, createCompanyAdmin, listPlatformAudit,
} = require('../controllers/platform.controller');

// NOTE: attachTenant is deliberately NOT mounted here. These routes are
// cross-tenant by design and are gated by requirePlatformAdmin instead,
// which reads a different session key (see middleware/platformAdmin.js).

// Unauthenticated: the platform operator's own login.
router.post('/login', asyncHandler(platformLogin));
router.get('/me', platformMe);
router.post('/logout', platformLogout);

// Everything below requires an active platform-admin session.
router.use(requirePlatformAdmin);

router.get('/groups', asyncHandler(listGroups));
router.post('/groups', asyncHandler(createGroup));
router.put('/groups/:id', asyncHandler(updateGroup));

router.get('/companies', asyncHandler(listCompanies));
router.post('/companies', asyncHandler(createCompany));
router.put('/companies/:id', asyncHandler(updateCompany));
router.put('/companies/:id/suspension', asyncHandler(setCompanySuspension));
router.post('/companies/:id/admin-user', asyncHandler(createCompanyAdmin));
router.get('/audit', asyncHandler(listPlatformAudit));

module.exports = router;
