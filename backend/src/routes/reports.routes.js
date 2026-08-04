const express = require('express');
const router = express.Router();
const { attachTenant } = require('../middleware/tenant');
const { requireEventAccess } = require('../middleware/eventAccess');
const { asyncHandler } = require('../utils/asyncHandler');
const { getCustomerAging, getCustomerAgingByContract, getDashboard, getTasks, getStatementOfAccount } = require('../controllers/reports.controller');
const performance = require('../controllers/performance.controller');

router.use(attachTenant);
router.use(requireEventAccess);

router.get('/customer-aging', asyncHandler(getCustomerAging));
router.get('/customer-aging-by-contract', asyncHandler(getCustomerAgingByContract));
router.get('/dashboard', asyncHandler(getDashboard));
router.get('/tasks', asyncHandler(getTasks));
router.get('/statement-of-account', asyncHandler(getStatementOfAccount));

// Performance Reports module (Excel "SALES REPORT" tab replacement)
router.get('/performance/overview', asyncHandler(performance.getOverview));
router.get('/performance/by-salesperson', asyncHandler(performance.getBySalesperson));
router.get('/performance/by-agent', asyncHandler(performance.getByAgent));
router.get('/performance/by-item', asyncHandler(performance.getByItem));
router.get('/performance/pipeline', asyncHandler(performance.getPipeline));
router.get('/performance/comparison', asyncHandler(performance.getComparison));
router.get('/performance/by-country', asyncHandler(performance.getByCountry));
router.get('/performance/by-month', asyncHandler(performance.getByMonth));
router.get('/performance/targets', asyncHandler(performance.getTargets));
router.put('/performance/targets', asyncHandler(performance.saveTargets));
router.get('/performance/agent-commission', asyncHandler(performance.getAgentCommission));
router.get('/performance/booth-space', asyncHandler(performance.getBoothSpace));

module.exports = router;
