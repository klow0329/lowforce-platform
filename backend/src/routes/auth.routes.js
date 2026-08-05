const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireLogin } = require('../middleware/auth');
const { login, logout, me, switchRole, changePassword, forgotPassword, getResetTokenInfo, resetPasswordWithToken } = require('../controllers/auth.controller');

router.post('/login', asyncHandler(login));
router.post('/logout', logout);
router.get('/me', asyncHandler(me));
router.post('/switch-role', requireLogin, asyncHandler(switchRole));
router.post('/change-password', requireLogin, asyncHandler(changePassword));

// PUBLIC — no login, deliberately (that's the point of "forgot password").
router.post('/forgot-password', asyncHandler(forgotPassword));
router.get('/reset-password/:token', asyncHandler(getResetTokenInfo));
router.post('/reset-password/:token', asyncHandler(resetPasswordWithToken));

module.exports = router;
