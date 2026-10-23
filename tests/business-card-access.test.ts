import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { canManageBusinessCard, canDeleteBusinessCard } from '../src/shared/business-card-access.ts';

test('only master can manage another staff card or delete cards',()=>{
  for(const role of ['master','ceo','cc_ref','admin','director','accountant','accountant_asst','manager','member','support']){
    const actor={sub:'self',role};
    assert.equal(canManageBusinessCard(actor,'self'),true);
    assert.equal(canManageBusinessCard(actor,'other'),role==='master');
    assert.equal(canDeleteBusinessCard(actor),role==='master');
  }
});
test('server protects owner selection, staff listing and delete routes, not just UI',()=>{
  const source=readFileSync(new URL('../src/worker/routes/business-cards.ts',import.meta.url),'utf8');
  assert.ok(source.includes("route.use('/manage/*', authMiddleware, requireHumanUser())"));
  assert.ok(source.includes('if(!canManageBusinessCard(actor,target))'));
  assert.ok(source.includes("if(c.get('user').role!=='master')"));
  assert.ok(source.includes("route.delete('/manage/me'"));
  assert.ok(source.includes('if(!canDeleteBusinessCard(c.get(\'user\')))'));
  assert.ok(source.includes('const id=ownerId(c)'));
  assert.ok(source.includes('const target=ownerId(c)'));
  assert.ok(source.includes("action==='publish' && (target.role==='resigned'||target.approved!==1)"));
});
test('deletion SQL removes only selected card and its links/events, never staff accounts',()=>{
  const source=readFileSync(new URL('../src/worker/routes/business-cards.ts',import.meta.url),'utf8');
  const queries=[...source.matchAll(/prepare\('(DELETE FROM business_card[^']+)'\)/g)].map(m=>m[1]);
  assert.equal(queries.length,4);
  const db=new Database(':memory:');
  try{
    db.exec(readFileSync(new URL('../d1/migrate-business-cards.sql',import.meta.url),'utf8'));
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('owner-a'),('owner-b')");
    for(const suffix of ['a','b']){
      db.prepare('INSERT INTO business_card_messages(user_id,template) VALUES(?,?)').run('owner-'+suffix,'message-'+suffix);
      db.prepare('INSERT INTO business_cards(user_id,slug,draft) VALUES(?,?,?)').run('owner-'+suffix,'slug-'+suffix,'{}');
      db.prepare('INSERT INTO business_card_short_links(code,card_slug) VALUES(?,?)').run('code-'+suffix,'slug-'+suffix);
      db.prepare('INSERT INTO business_card_events(slug,visitor,kind,bucket) VALUES(?,?,?,?)').run('slug-'+suffix,'visitor','visit',1);
    }
    db.transaction(()=>{for(const sql of queries){if(sql.includes('business_card_messages'))db.prepare(sql).run('owner-a');else if(sql.includes('user_id=?'))db.prepare(sql).run('owner-a','slug-a');else db.prepare(sql).run('slug-a')}})();
    assert.equal((db.prepare('SELECT COUNT(*) n FROM users').get() as {n:number}).n,2);
    assert.deepEqual(db.prepare('SELECT user_id FROM business_cards').all(),[{user_id:'owner-b'}]);
    assert.deepEqual(db.prepare('SELECT card_slug FROM business_card_short_links').all(),[{card_slug:'slug-b'}]);
    assert.deepEqual(db.prepare('SELECT slug FROM business_card_events').all(),[{slug:'slug-b'}]);
    assert.deepEqual(db.prepare('SELECT user_id FROM business_card_messages').all(),[{user_id:'owner-b'}]);
  }finally{db.close()}
});
