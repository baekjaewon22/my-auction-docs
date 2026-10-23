import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { defaultCardMessage, normalizeCardMessage, renderCardMessage, editCardMessage } from '../src/shared/business-card-message.ts';

test('resolved text editing preserves automatic fields and custom edits',()=>{
  const card={name:'백재원',title:'실장'};
  const url='https://example.test/card/abc234';
  const visible=renderCardMessage(defaultCardMessage,card,url);
  assert.equal(editCardMessage(visible,defaultCardMessage,card,url),defaultCardMessage);
  const edited=editCardMessage(visible.replace('안녕하세요.','반갑습니다.'),defaultCardMessage,card,url);
  assert.ok(edited.startsWith('반갑습니다.'));assert.ok(edited.includes('{이름 직책}'));
  assert.ok(renderCardMessage(edited,{...card,title:'팀장'},url).includes('백재원 팀장'));
  assert.ok(!editCardMessage(visible.replace(url,''),defaultCardMessage,card,url).includes('{전자명함 링크}'));
  assert.equal(editCardMessage('직접 쓴 이름','직접 쓴 이름',card,url),'직접 쓴 이름');
});

test('default message resolves identity and link, and keeps custom text and line breaks',()=>{
  const card={name:'백재원',title:'실장'};
  const url='https://example.test/card/abcd2345';
  const rendered=renderCardMessage(defaultCardMessage,card,url);
  assert.ok(rendered.startsWith('안녕하세요. 방금 통화드린 마이옥션 백재원 실장입니다.\n'));
  assert.ok(rendered.endsWith(`[프로필 링크 / 전자명함]\n${url}`));
  assert.equal(renderCardMessage('[{전자명함 링크}]',card,url),url);
  assert.equal(renderCardMessage('{이름}\n{직책}\n{전자명함 링크}',card,url),`백재원\n실장\n${url}`);
  assert.equal(renderCardMessage('직접 작성한 내용',card,url),'직접 작성한 내용');
  assert.equal(renderCardMessage('{이름 직책}',{...card,title:''},url),'백재원');
  assert.equal(renderCardMessage('{이름}',{name:'$&',title:''},url),'$&');
});
test('message validation rejects malformed, empty and oversized values',()=>{
  for(const value of [null,{},42,'  ','x'.repeat(3001)])assert.throws(()=>normalizeCardMessage(value));
  assert.equal(normalizeCardMessage(' 안내\n문구 '),'안내\n문구');
});
test('delivery template persists separately per owner without touching card/image snapshots',()=>{
  const source=readFileSync(new URL('../src/worker/routes/business-cards.ts',import.meta.url),'utf8');
  const handler=source.split("route.put('/manage/message'")[1].split("route.put('/manage/me'")[0];
  assert.ok(handler.includes('const id=ownerId(c)'));
  const sql=handler.match(/prepare\(`(INSERT INTO business_card_messages[^`]+)`\)/)![1];
  const db=new Database(':memory:');
  try{
    const migration=readFileSync(new URL('../d1/migrate-business-cards.sql',import.meta.url),'utf8');
    db.exec(migration);db.exec(migration);
    const snapshot=JSON.stringify({photo:'original photo',companyImage:'original image'});
    db.prepare('INSERT INTO business_cards(user_id,slug,draft,published) VALUES(?,?,?,?)').run('a','slug',snapshot,snapshot);
    db.prepare(sql).run('a',defaultCardMessage);db.prepare(sql).run('b','다른 담당자');
    db.prepare(sql).run('a','수정한 문구');
    assert.deepEqual(db.prepare('SELECT user_id,template FROM business_card_messages ORDER BY user_id').all(),[{user_id:'a',template:'수정한 문구'},{user_id:'b',template:'다른 담당자'}]);
    assert.deepEqual(db.prepare('SELECT draft,published FROM business_cards').get(),{draft:snapshot,published:snapshot});
  }finally{db.close()}
});
