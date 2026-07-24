// Management can view everything and still approve/reject contracts (that
// stays on its own separate routes in approvals.controller.js), but can't
// create or edit Opportunities, Contracts or Floor Plan booths — enforced
// here too since hiding a button in the UI isn't real access control.
function blockManagementWrites(req, res, next) {
  if (req.roleCode === 'MGT') {
    return res.status(403).json({ error: 'Management is view-only here — editing is not permitted for this role.' });
  }
  next();
}

module.exports = { blockManagementWrites };
