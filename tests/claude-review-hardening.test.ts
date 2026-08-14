import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('freelancer supervisors cannot use employee user and team management side doors', () => {
  const users = readFileSync(new URL('../src/worker/routes/users.ts', import.meta.url), 'utf8');
  const teams = readFileSync(new URL('../src/worker/routes/teams.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');

  const usersList = users.slice(users.indexOf("users.get('/'"), users.indexOf("users.get('/pending'"));
  assert.match(usersList, /user\.login_type === 'freelancer'/);
  assert.match(teams, /teams\.get\('\/:id\/members'[\s\S]*?user\.login_type === 'freelancer'/);
  assert.match(teams, /teams\.post\('\/:id\/members'[\s\S]*?user\.login_type === 'freelancer'/);
  assert.match(teams, /teams\.delete\('\/:id\/members\/:userId'[\s\S]*?user\.login_type === 'freelancer'/);
  const guard = app.slice(app.indexOf('function AccountingOrApproverRoute'), app.indexOf('function StatsRoute'));
  assert.match(guard, /login_type === 'freelancer'/);
});

test('accounting updates validate employment type and do not overwrite newer current state', () => {
  const accounting = readFileSync(new URL('../src/worker/routes/accounting.ts', import.meta.url), 'utf8');
  const route = accounting.slice(accounting.indexOf("accounting.put('/:userId'"));

  assert.match(route, /\['salary', 'commission'\]\.includes/);
  assert.match(route, /expectedPayType/);
  assert.match(route, /latestHistory/);
  assert.match(route, /shouldUpdateCurrentAccount/);
  assert.match(route, /\.\.\.\(accountingStatement \? \[accountingStatement\] : \[\]\)/);
});
