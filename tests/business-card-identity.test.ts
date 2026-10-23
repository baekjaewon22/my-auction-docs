import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationCard, cardVcf } from '../src/shared/business-card.ts';
import { prepareCardIdentity, resolveStoredCard } from '../src/shared/business-card-identity.ts';

const profile = { name:'원래 이름', position_title:'팀장', department:'1팀', branch:'의정부', phone:'01012345678' };
test('master edits all card identity including phone without changing account',()=>{
  const input={...registrationCard(profile),name:'명함 이름',title:'실장',department:'경매사업부',branch:'본사',phone:'01099999999'};
  const saved=prepareCardIdentity(input,profile,{},'master');
  const loaded=resolveStoredCard(JSON.parse(JSON.stringify(saved)),profile);
  for(const key of ['name','title','department','branch'] as const) assert.equal(loaded[key],input[key]);
  assert.equal(loaded.phone,'010.9999.9999');
  assert.ok(cardVcf(loaded).includes('TEL;TYPE=CELL:010.9999.9999'));
  assert.equal(profile.phone,'01012345678');
  assert.equal(profile.name,'원래 이름');
});
test('normal roles cannot forge identity or override metadata, but preserve stored overrides',()=>{
  const original=registrationCard(profile);
  const stored=prepareCardIdentity({...original,name:'지정 이름',phone:'01088888888'},profile,{},'master');
  for(const role of ['member','admin','ceo','director','manager']) {
    const forged={...original,name:'위조',phone:'01099999999',identityOverrides:{name:'위조',phone:'01099999999'}};
    assert.equal(prepareCardIdentity(forged,profile,{},role).name,profile.name);
    assert.equal(prepareCardIdentity(forged,profile,stored,role).name,'지정 이름');
    assert.equal(prepareCardIdentity(forged,profile,{},role).phone,'010.1234.5678');
    assert.equal(prepareCardIdentity(forged,profile,stored,role).phone,'010.8888.8888');
  }
});
test('legacy cards sync; draft changes do not affect published identity; clearing overrides resumes sync',()=>{
  const original=registrationCard(profile);
  assert.equal(resolveStoredCard(original,{...profile,name:'새 이름'}).name,'새 이름');
  const published=prepareCardIdentity({...original,name:'공개 이름'},profile,{},'master');
  const draft=prepareCardIdentity({...published,name:'초안 이름'},profile,published,'master');
  assert.equal(resolveStoredCard(published,profile).name,'공개 이름');
  assert.equal(resolveStoredCard(draft,profile).name,'초안 이름');
  const reset=prepareCardIdentity(original,profile,draft,'master');
  assert.equal(resolveStoredCard(reset,{...profile,name:'변경된 회원명'}).name,'변경된 회원명');
});
