import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('tenant access does not trust the global marketing user administrator role', () => {
  const auth = read('worker/auth.ts');
  const access = read('worker/accessControl.ts');
  assert.doesNotMatch(auth, /platformRole === 'super_admin' \|\| user\.role === 'administrator'/);
  assert.match(auth, /resolveTenantMembershipRole/);
  assert.match(access, /crm_company_members\?company_id=eq\./);
  assert.match(access, /membershipRole === 'owner' \|\| membershipRole === 'administrator'/);
});

test('team roles are membership scoped and include operational roles', () => {
  const migration = read('supabase/migrations/20260818044500_team_invitations_roles.sql');
  for (const role of ['owner','administrator','manager','marketer','operator','analyst','viewer']) assert.match(migration, new RegExp(`'${role}'`));
  const admin = read('worker/userAdmin.ts');
  assert.match(admin, /role: text\(membership\.role\)/);
  assert.doesNotMatch(admin, /marketing_users\?id=eq\.\$\{targetId\}.*role/s);
});

test('personal invitations are single use, expiring and revocable', () => {
  const admin = read('worker/userAdmin.ts');
  assert.match(admin, /max_uses: 1/);
  assert.match(admin, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(admin, /status: 'revoked'/);
  assert.match(admin, /active: false/);
});

test('join applications support approval and rejection with tenant role assignment', () => {
  const admin = read('worker/userAdmin.ts');
  assert.match(admin, /\/onboarding/);
  assert.match(admin, /status: 'approved'/);
  assert.match(admin, /status: 'rejected'/);
  assert.match(admin, /crm_company_members\?company_id=eq\.\$\{companyId\}&user_id=eq\.\$\{userId\}/);
});

test('ownership transfer is atomic and only targets an active member', () => {
  const migration = read('supabase/migrations/20260818045000_team_admin_rpcs.sql');
  assert.match(migration, /imds_transfer_company_ownership/);
  assert.match(migration, /v_target_status/);
  assert.match(migration, /set role='administrator'/);
  assert.match(migration, /set role='owner', status='active'/);
});

test('organization workspace exposes invitations and onboarding UI', () => {
  const workspace = read('src/components/UserWorkspaceModal.tsx');
  const team = read('src/components/TeamAdministrationPanel.tsx');
  assert.match(workspace, /TeamAdministrationPanel/);
  assert.match(team, /Заявки на вступление/);
  assert.match(team, /Приглашения/);
  assert.match(team, /Передать владение/);
});
