-- Multi-role support: some users (e.g. an owner who is both Admin and
-- Finance) need to act under more than one role and switch between them,
-- rather than always seeing the union of every permission at once.
-- users.role_id stays as-is (their default/primary role, used at login and
-- still required on user creation); this junction table is the full set of
-- roles a user is ALLOWED to switch into via the new role switcher.
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Every existing user's current single role becomes their (only) assigned
-- role, so nothing changes for them until an Admin grants more.
INSERT INTO user_roles (user_id, role_id)
SELECT id, role_id FROM users WHERE role_id IS NOT NULL
ON CONFLICT DO NOTHING;
