// Management can see everything (same as Admin, per visibility.js on the
// backend) and is still an approver — that's their actual job — but cannot
// create or edit Opportunities, Contracts or Floor Plan booths; view + print
// only. Every other role's existing permissions are unchanged by this.
export function isViewOnly(user) {
  return user?.role_code === 'MGT';
}
