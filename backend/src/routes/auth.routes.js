const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireLogin } = require('../middleware/auth');
const { login, logout, me, changePassword } = require('../controllers/auth.controller');

router.post('/login', asyncHandler(login));
router.post('/logout', logout);
router.get('/me', asyncHandler(me));
router.post('/change-password', requireLogin, asyncHandler(changePassword));

module.exports = router;
