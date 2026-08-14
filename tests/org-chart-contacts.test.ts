import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const orgChart = readFileSync(new URL('../src/react-app/pages/OrgChart.tsx', import.meta.url), 'utf8');
const phoneDirectory = readFileSync(new URL('../src/react-app/pages/PhoneDirectory.tsx', import.meta.url), 'utf8');
const usersRoute = readFileSync(new URL('../src/worker/routes/users.ts', import.meta.url), 'utf8');

test('organization user query includes phone and does not exclude freelancers', () => {
  assert.match(usersRoute, /SELECT id, email, name, phone, role/);
  assert.doesNotMatch(usersRoute, /FROM users WHERE approved = 1 AND COALESCE\(login_type, 'employee'\) != 'freelancer'/);
});

test('phone directory includes freelancers and groups them by organization-synced branch and department', () => {
  assert.doesNotMatch(phoneDirectory, /user\.login_type[^\n]+freelancer/);
  assert.match(phoneDirectory, /normalizeBranchName\(user\.branch\)/);
  assert.match(phoneDirectory, /user\.department \|\| user\.team_name/);
  assert.match(phoneDirectory, /formatPhone\(member\.phone\)/);
});

test('organization chart does not duplicate phone-directory contacts', () => {
  assert.doesNotMatch(orgChart, /oc-card-phone|ocm-phone|phoneHref|displayPhone/);
});
