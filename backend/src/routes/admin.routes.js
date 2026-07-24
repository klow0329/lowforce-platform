const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listUsers, createUser, updateUser, resetPassword, listRoles, setUserEventAccess, setUserRoles,
  listEvents, createEvent, updateEvent,
} = require('../controllers/admin.controller');

router.use(attachTenant);
router.use(requireAdmin); // everything below is admin-only

router.get('/users', asyncHandler(listUsers));
router.post('/users', asyncHandler(createUser));
router.put('/users/:id', asyncHandler(updateUser));
router.post('/users/:id/reset-password', asyncHandler(resetPassword));
router.put('/users/:id/events', asyncHandler(setUserEventAccess));
router.put('/users/:id/roles', asyncHandler(setUserRoles));
router.get('/roles', asyncHandler(listRoles));

router.get('/events', asyncHandler(listEvents));
router.post('/events', asyncHandler(createEvent));
router.put('/events/:id', asyncHandler(updateEvent));

module.exports = router;
