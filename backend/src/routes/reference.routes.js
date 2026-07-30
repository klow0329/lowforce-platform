const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { asyncHandler } = require('../utils/asyncHandler');
const { listCountries, listAgents, listSegments, listSalespeople, listEvents, listStages, getCompany, listCnReasonCodes } = require('../controllers/reference.controller');

router.use(attachTenant); // reference data still requires login, even though countries aren't company-scoped

router.get('/countries', asyncHandler(listCountries));
router.get('/agents', asyncHandler(listAgents));
router.get('/segments', asyncHandler(listSegments));
router.get('/salespeople', asyncHandler(listSalespeople));
router.get('/events', asyncHandler(listEvents));
router.get('/stages', asyncHandler(listStages));
router.get('/cn-reason-codes', asyncHandler(listCnReasonCodes));
router.get('/company', asyncHandler(getCompany));

module.exports = router;
