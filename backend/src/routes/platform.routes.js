const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const {
  platformLogin, platformMe, platformLogout, platformChangePassword,
  listGroups, createGroup, updateGroup, deleteGroup,
  listCompanies, createCompany, updateCompany, deleteCompany, setCompanySuspension, createCompanyAdmin,
  listCompanyUsers, updateCompanyUser, resetCompanyUserPassword,
  listPlatformAudit,
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

router.put('/me/password', asyncHandler(platformChangePassword));

router.get('/groups', asyncHandler(listGroups));
router.post('/groups', asyncHandler(createGroup));
router.put('/groups/:id', asyncHandler(updateGroup));
router.delete('/groups/:id', asyncHandler(deleteGroup));

router.get('/companies', asyncHandler(listCompanies));
router.post('/companies', asyncHandler(createCompany));
router.put('/companies/:id', asyncHandler(updateCompany));
router.delete('/companies/:id', asyncHandler(deleteCompany));
router.put('/companies/:id/suspension', asyncHandler(setCompanySuspension));
router.post('/companies/:id/admin-user', asyncHandler(createCompanyAdmin));
router.get('/companies/:id/users', asyncHandler(listCompanyUsers));
router.put('/companies/:id/users/:userId', asyncHandler(updateCompanyUser));
router.post('/companies/:id/users/:userId/reset-password', asyncHandler(resetCompanyUserPassword));

router.get('/audit', asyncHandler(listPlatformAudit));

module.exports = router;
