import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanUser } from '../middleware/auth';
import { type CardProfile, cardVcf, type BusinessCard } from '../../shared/business-card';
import { businessCardPage } from '../lib/business-card-page';
import { ensureCardShortLink, publishedCardSql, cardLinkWithoutClosingBracket } from '../lib/business-card-short-link';
import { canManageBusinessCard, canDeleteBusinessCard } from '../../shared/business-card-access';
import { defaultCardMessage, normalizeCardMessage } from '../../shared/business-card-message';

import { resolveStoredCard, prepareCardIdentity } from '../../shared/business-card-identity';

const route = new Hono<AuthEnv>();
route.onError((error,c)=>{
  if(error instanceof HTTPException) return c.json({error:error.message},error.status);
  console.error('[business-cards]',error.message);
  return c.json({error:'명함 처리에 실패했습니다. 다시 시도해 주세요.'},500);
});
type Row = { user_id: string; slug: string; draft: string; published: string | null };
const schemaPromises = new WeakMap<D1Database, Promise<unknown>>();
async function schema(db: D1Database) {
  if (schemaPromises.has(db)) return schemaPromises.get(db);
  const promise = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS business_cards (user_id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, draft TEXT NOT NULL, published TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS business_card_events (slug TEXT NOT NULL, visitor TEXT NOT NULL, kind TEXT NOT NULL, bucket INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(slug,visitor,kind,bucket))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS business_card_short_links (code TEXT PRIMARY KEY, card_slug TEXT NOT NULL UNIQUE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS business_card_messages (user_id TEXT PRIMARY KEY, template TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
  ]).catch(error => { schemaPromises.delete(db); throw error; });
  schemaPromises.set(db, promise);
  return promise;
}
route.use('*', async (c, next) => { await schema(c.env.DB); c.header('Cache-Control','no-store'); await next(); });
route.use('/manage/*', authMiddleware, requireHumanUser());
function ownerId(c: Context<AuthEnv>): string {
  const actor=c.get('user');
  const target=c.req.query('user_id') || actor.sub;
  if(!canManageBusinessCard(actor,target)) throw new HTTPException(403,{message:'본인 명함만 관리할 수 있습니다.'});
  return target;
}
route.get('/manage/users', async c => {
  if(c.get('user').role!=='master') return c.json({error:'마스터만 담당자 목록을 조회할 수 있습니다.'},403);
  const result=await c.env.DB.prepare(`SELECT u.id,u.name,u.department,u.position_title,u.branch,u.role,CASE WHEN bc.user_id IS NULL THEN 0 ELSE 1 END has_card FROM users u LEFT JOIN business_cards bc ON bc.user_id=u.id WHERE u.approved=1 OR bc.user_id IS NOT NULL ORDER BY u.name,u.id`).all();
  return c.json({users:result.results});
});
route.get('/manage/me', async c => {
  const user = c.get('user');
  const target=ownerId(c);
  const profile = await c.env.DB.prepare('SELECT name,phone,email,department,position_title,branch FROM users WHERE id=?').bind(target).first<{name:string;phone:string;email:string;department:string;position_title:string;branch:string}>();
  if(!profile) return c.json({error:'담당자를 찾을 수 없습니다.'},404);
  const row = await c.env.DB.prepare('SELECT * FROM business_cards WHERE user_id = ?').bind(target).first<Row>();
  const stats = row ? await c.env.DB.prepare(`SELECT COUNT(CASE WHEN kind='visit' THEN 1 END) visits, COUNT(DISTINCT CASE WHEN kind='visit' THEN visitor END) visitors, COUNT(CASE WHEN kind='phone' THEN 1 END) phone, COUNT(CASE WHEN kind='kakao' THEN 1 END) kakao, COUNT(CASE WHEN kind='save' THEN 1 END) saves FROM business_card_events WHERE slug=?`).bind(row.slug).first() : { visits:0, visitors:0, phone:0, kakao:0, saves:0 };
  const card=resolveStoredCard(row ? JSON.parse(row.draft) : {},profile);
  if(card.boxColor==='orange')card.boxColor='navy';
  const delivery=await c.env.DB.prepare('SELECT template FROM business_card_messages WHERE user_id=?').bind(target).first<{template:string}>();
  return c.json({card, message_template:delivery?.template ?? defaultCardMessage, owner_id:target, can_select_user:user.role==='master', exists:!!row, slug:row ? await ensureCardShortLink(c.env.DB,row.slug) : undefined, published:!!row?.published, stats});
});
route.put('/manage/message', async c => {
  const id=ownerId(c);
  const profile=await c.env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first();
  if(!profile) return c.json({error:'담당자를 찾을 수 없습니다.'},404);
  const raw=await c.req.text();
  if(raw.length>20000) return c.json({error:'안내 문구가 너무 깁니다.'},413);
  let template:string;
  try { template=normalizeCardMessage(JSON.parse(raw).template); }
  catch(e) { return c.json({error:e instanceof Error?e.message:'입력 오류'},400); }
  await c.env.DB.prepare(`INSERT INTO business_card_messages(user_id,template) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET template=excluded.template,updated_at=CURRENT_TIMESTAMP`).bind(id,template).run();
  return c.json({template});
});
route.put('/manage/me', async c => {
  const id=ownerId(c);
  const target=await c.env.DB.prepare('SELECT name,phone,email,department,position_title,branch,role,approved FROM users WHERE id=?').bind(id).first<CardProfile & {role:string;approved:number}>();
  if(!target) return c.json({error:'담당자를 찾을 수 없습니다.'},404);
  if (Number(c.req.header('content-length') || 0) > 1500000) return c.json({error:'사진이 너무 큽니다.'},413);
  const raw = await c.req.text();
  if (raw.length > 1500000) return c.json({error:'사진이 너무 큽니다.'},413);
  const existing = await c.env.DB.prepare('SELECT * FROM business_cards WHERE user_id=?').bind(id).first<Row>();
  let card: BusinessCard; let action: string;
  try { const input = JSON.parse(raw); card = prepareCardIdentity(input.card,target,existing ? JSON.parse(existing.draft) : {},c.get('user').role); action = input.action; if (!['save','publish','unpublish'].includes(action)) throw new Error('작업을 확인해 주세요.'); }
  catch(e) { return c.json({error:e instanceof Error ? e.message : '입력 오류'},400); }
  if(action==='publish' && (target.role==='resigned'||target.approved!==1)) return c.json({error:'미승인 또는 퇴사자의 명함은 공개할 수 없습니다.'},403);
  const slug = existing?.slug || crypto.randomUUID();
  const json = JSON.stringify(card);
  const published = action === 'publish' ? json : action === 'unpublish' ? null : existing?.published || null;
  await c.env.DB.prepare(`INSERT INTO business_cards(user_id,slug,draft,published) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET draft=excluded.draft,published=excluded.published,updated_at=CURRENT_TIMESTAMP`).bind(id,slug,json,published).run();
  const saved=await c.env.DB.prepare('SELECT slug FROM business_cards WHERE user_id=?').bind(id).first<{slug:string}>();
  return c.json({card,slug:await ensureCardShortLink(c.env.DB,saved!.slug),published:!!published});
});
route.delete('/manage/me', async c => {
  if(!canDeleteBusinessCard(c.get('user'))) return c.json({error:'마스터만 명함을 삭제할 수 있습니다.'},403);
  const id=ownerId(c);
  const row=await c.env.DB.prepare('SELECT slug FROM business_cards WHERE user_id=?').bind(id).first<{slug:string}>();
  if(!row) return c.json({error:'삭제할 명함이 없습니다.'},404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM business_card_events WHERE slug=?').bind(row.slug),
    c.env.DB.prepare('DELETE FROM business_card_short_links WHERE card_slug=?').bind(row.slug),
    c.env.DB.prepare('DELETE FROM business_card_messages WHERE user_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM business_cards WHERE user_id=? AND slug=?').bind(id,row.slug),
  ]);
  return c.json({ok:true});
});
route.post('/manage/preview', async c => {
  const id=ownerId(c);
  const profile=await c.env.DB.prepare('SELECT name,phone,email,department,position_title,branch FROM users WHERE id=?').bind(id).first<CardProfile>();
  if(!profile) return c.text('담당자를 찾을 수 없습니다.',404);
  const existing = await c.env.DB.prepare('SELECT * FROM business_cards WHERE user_id=?').bind(id).first<Row>();
  try { const raw = await c.req.text(); if(raw.length>1500000) return c.text('사진이 너무 큽니다.',413); return c.html(businessCardPage(prepareCardIdentity(JSON.parse(raw),profile,existing ? JSON.parse(existing.draft) : {},c.get('user').role), '', true)); }
  catch { return c.text('이름과 전화번호, 명함 내용을 확인해 주세요.',400); }
});

async function published(db: D1Database, slug: string) {
  const row=await db.prepare(publishedCardSql).bind(slug,slug).first<Row>();
  if(!row) return null;
  const profile=await db.prepare('SELECT name,phone,email,department,position_title,branch FROM users WHERE id=?').bind(row.user_id).first<CardProfile>();
  if(!profile) return null;
  return {...row,published:JSON.stringify(resolveStoredCard(JSON.parse(row.published!),profile))};
}
route.get('/:slug/photo', async c => {
  const row = await published(c.env.DB,c.req.param('slug')); if(!row) return c.notFound();
  const card = JSON.parse(row.published!) as BusinessCard;
  if(!card.photo) return c.notFound();
  const bytes = Uint8Array.from(atob(card.photo.split(',')[1]), ch=>ch.charCodeAt(0));
  return new Response(bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
});
route.get('/:slug/contact.vcf', async c => {
  const row = await published(c.env.DB,c.req.param('slug')); if(!row) return c.notFound();
  return c.body(cardVcf(JSON.parse(row.published!)),200,{'Content-Type':'text/vcard; charset=utf-8','Content-Disposition':'attachment; filename="contact.vcf"'});
});
route.post('/:slug/event', async c => {
  const origin = c.req.header('origin');
  if(origin !== new URL(c.req.url).origin) return c.json({error:'Forbidden'},403);
  if (/bot|crawler|spider|preview/i.test(c.req.header('user-agent') || '')) return c.json({ok:true});
  const raw = await c.req.text(); if(raw.length>300) return c.json({error:'Invalid event'},400);
  let event: {kind:string;visitor:string};
  try { event=JSON.parse(raw); } catch { return c.json({error:'Invalid event'},400); }
  if (!event || typeof event !== 'object' || !['visit','phone','kakao','save'].includes(event.kind) || typeof event.visitor !== 'string' || !/^[a-f0-9-]{36}$/.test(event.visitor)) return c.json({error:'Invalid event'},400);
  const row=await published(c.env.DB,c.req.param('slug')); if(!row) return c.notFound();
  const slug=row.slug;
  // Only per-card hashed browser IDs; no IP address, name or phone is retained.
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(slug+event.visitor));
  const visitor=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const bucket=Math.floor(Date.now()/(event.kind==='visit'?1800000:10000));
  await c.env.DB.prepare('INSERT OR IGNORE INTO business_card_events(slug,visitor,kind,bucket) VALUES(?,?,?,?)').bind(slug,visitor,event.kind,bucket).run();
  return c.json({ok:true});
});
route.get('/:slug', async c => {
  const row=await published(c.env.DB,c.req.param('slug'));
  if(!row){
    const corrected=cardLinkWithoutClosingBracket(c.req.param('slug'));
    if(corrected && await published(c.env.DB,corrected)) return c.redirect('/card/'+corrected,302);
  }
  if(!row) return c.html('<!doctype html><meta charset="utf-8"><h1>공개되지 않은 명함입니다.</h1><p>담당자에게 연락해 주세요.</p>',404);
  const alias=await c.env.DB.prepare('SELECT code FROM business_card_short_links WHERE card_slug=?').bind(row.slug).first<{code:string}>();
  return c.html(businessCardPage(JSON.parse(row.published!),new URL(c.req.url).origin+'/card/'+(alias?.code || row.slug)));
});
export default route;
