import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCard, cardColors, youtubeVideoId, registrationCard, normalizeCard, escapeCardHtml, cardVcf, syncCardProfile, formatCardPhone } from '../src/shared/business-card.ts';
import { ensureCardShortLink, newCardCode, publishedCardSql, cardLinkWithoutClosingBracket } from '../src/worker/lib/business-card-short-link.ts';
import { businessCardPage } from '../src/worker/lib/business-card-page.ts';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { companyIntroduction, companyIntroductionCss, companyIntroductionScript, companyCarouselScript, companyImageZoomScript, companyServices } from '../src/worker/lib/business-card-company.ts';
import { runInNewContext } from 'node:vm';

const valid = {...blankCard,name:'홍길동',phone:'010-1234-5678'};
test('account identity overrides stored or forged identity while email remains customizable',()=>{
  const profile={name:'현재 이름',phone:'01012345678',department:'새 부서 1팀',position_title:'팀장',branch:'의정부',email:'account@example.com'};
  const current=syncCardProfile({...valid,department:'옛 부서',title:'옛 직책',branch:'옛 지점',email:'custom@example.com'},profile);
  assert.equal(current.name,profile.name);assert.equal(current.department,profile.department);
  assert.equal(current.title,profile.position_title);assert.equal(current.branch,'의정부 본사');
  assert.equal(current.phone,'010.1234.5678');assert.equal(current.email,'custom@example.com');
  assert.equal(syncCardProfile({},profile).email,'account@example.com');
  assert.equal(syncCardProfile({...current,email:''},profile).email,'');
  assert.equal(syncCardProfile(current,{...profile,name:'변경된 이름'}).name,'변경된 이름');
  for(const input of [null,[],42,'invalid'])assert.throws(()=>syncCardProfile(input,profile));
});
test('all mobile phone formats display consistently in management and public cards',()=>{
  for(const phone of ['01012345678','010-1234-5678','010.1234.5678']){
    assert.equal(formatCardPhone(phone),'010.1234.5678');
    assert.equal(normalizeCard({...valid,phone}).phone,'010.1234.5678');
    const html=businessCardPage({...valid,phone},'');
    assert.ok(html.includes('010.1234.5678'));assert.ok(html.includes('tel:01012345678'));
  }
});
test('company advertising scales the circular design and uses the original fee image without HTML reconstruction',()=>{
  const html=companyIntroduction();
  assert.ok(html.includes('class="company-carousel"'));
  assert.ok(html.includes('id="company-slide-2" hidden'));
  assert.ok(html.includes('src="/brand/company-consulting-fees.png"'));
  assert.ok(html.includes('class="company-fee-image-link company-zoom-trigger"'));
  assert.ok(!html.includes('class="fee-rate-grid"'));
  assert.ok(companyIntroductionCss.includes('aspect-ratio:1490/1060;container-type:inline-size'));
  assert.ok(companyIntroductionCss.includes('white-space:nowrap'));
  assert.ok(!companyIntroductionCss.includes('grid-template-columns'));
  assert.ok(!companyIntroductionCss.includes('overflow-y:auto'));
  assert.equal((html.match(/class="company-prev"/g)||[]).length,1);
  assert.equal((html.match(/class="company-next"/g)||[]).length,1);
});
test('company section can be hidden or replaced with an uploaded image, with safe legacy defaults',()=>{
  const hidden=businessCardPage({...valid,companyHidden:'yes'},'');
  assert.ok(!hidden.includes('class="company-carousel"'));
  assert.ok(!hidden.includes('id="company-zoom-dialog"'));
  const custom=businessCardPage({...valid,companyImage:'data:image/jpeg;base64,/9j/AA=='},'');
  assert.ok(custom.includes('class="company-custom"'));
  assert.ok(!custom.includes('class="company-carousel"'));
  assert.ok(custom.includes('id="company-zoom-dialog"'));
  assert.throws(()=>normalizeCard({...valid,companyImage:'data:image/svg+xml;base64,abc'}));
  assert.throws(()=>normalizeCard({...valid,companyHidden:'maybe'}));
  const {companyHidden,companyImage,...legacy}=valid;
  assert.equal(normalizeCard(legacy).companyHidden,'');
  assert.equal(normalizeCard(legacy).companyImage,'');
  assert.ok(companyServices[6].lead.includes('법무법인 명승'));
  assert.ok(!companyServices[6].lead.includes('법률사무소'));
});
test('image popup opens the clicked image and closes through the close button',()=>{
  const large={src:'',alt:''};const source={src:'/brand/company-consulting-fees.png',alt:'수수료 안내'};
  const close={click:()=>{},addEventListener(_type:string,fn:()=>void){this.click=fn}};
  const dialog={open:false,querySelector:(s:string)=>s==='img'?large:close,showModal(){this.open=true},close(){this.open=false},addEventListener(){}};
  const trigger={click:()=>{},querySelector:()=>source,addEventListener(_type:string,fn:()=>void){this.click=fn}};
  runInNewContext(companyImageZoomScript,{document:{getElementById:()=>dialog,querySelectorAll:()=>[trigger]}});
  trigger.click();assert.equal(dialog.open,true);assert.equal(large.src,source.src);assert.equal(large.alt,source.alt);
  close.click();assert.equal(dialog.open,false);
});
test('carousel arrows cycle between exactly one visible slide without autoplay',()=>{
  const slides=[{hidden:false,scrollTop:100},{hidden:true,scrollTop:100}];
  const label={textContent:''};
  const prev={click:()=>{},addEventListener(_kind:string,fn:()=>void){this.click=fn}};
  const next={click:()=>{},addEventListener(_kind:string,fn:()=>void){this.click=fn}};
  const root={querySelectorAll:()=>slides,querySelector:(selector:string)=>selector==='.company-page-label'?label:selector==='.company-prev'?prev:next};
  runInNewContext(companyCarouselScript,{document:{querySelectorAll:()=>[root]}});
  assert.deepEqual(slides.map(s=>s.hidden),[false,true]);
  next.click();assert.deepEqual(slides.map(s=>s.hidden),[true,false]);assert.equal(label.textContent,'2 / 2 · 컨설팅 수수료');assert.equal(slides[1].scrollTop,0);
  next.click();assert.deepEqual(slides.map(s=>s.hidden),[false,true]);
  prev.click();assert.deepEqual(slides.map(s=>s.hidden),[true,false]);
  prev.click();assert.deepEqual(slides.map(s=>s.hidden),[false,true]);
});
test('fixed company introduction contains seven initially hidden service descriptions at the bottom',()=>{
  const html=companyIntroduction();
  assert.equal(companyServices.length,7);
  assert.equal((html.match(/aria-expanded="false"/g)||[]).length,7);
  assert.equal((html.match(/<section hidden id="company-detail-/g)||[]).length,7);
  for(const service of companyServices){assert.ok(html.includes(service.title));assert.ok(html.includes(service.body));}
  const page=businessCardPage({...valid,youtubeUrl:'https://www.youtube.com/@test'},'');
  assert.ok(page.indexOf('class="company-intro"')>page.indexOf('aria-label="SNS 바로가기"'));
  assert.ok(page.indexOf('class="company-intro"')<page.indexOf('</main>'));
});
test('service clicks reveal only the selected explanation, toggle closed and restore focus',()=>{
  const makeButton=(i:number)=>({attrs:{'aria-expanded':'false','aria-controls':`company-detail-${i}`} as Record<string,string>,focused:false,click:()=>{},setAttribute(key:string,value:string){this.attrs[key]=value},getAttribute(key:string){return this.attrs[key]},addEventListener(_kind:string,fn:()=>void){this.click=fn},focus(){this.focused=true}});
  const buttons=companyServices.map((_,i)=>makeButton(i+1));
  const panels=companyServices.map((_,i)=>({id:`company-detail-${i+1}`,hidden:true}));
  const closes=companyServices.map((_,i)=>makeButton(i+1));
  const root={querySelectorAll:(selector:string)=>selector==='.company-step'?buttons:selector==='.company-detail'?panels:closes};
  runInNewContext(companyIntroductionScript,{document:{querySelectorAll:()=>[root]}});
  for(let i=0;i<7;i++){buttons[i].click();assert.deepEqual(panels.filter(p=>!p.hidden).map(p=>p.id),[`company-detail-${i+1}`]);assert.equal(buttons.filter(b=>b.attrs['aria-expanded']==='true').length,1)}
  buttons[6].click();assert.ok(panels.every(p=>p.hidden));
  buttons[2].click();closes[2].click();assert.ok(panels.every(p=>p.hidden));assert.equal(buttons[2].focused,true);
});
test('business card only accepts public allowlisted fields',()=>{
  const result=normalizeCard({...valid,user_id:'other',sales:10000});
  assert.equal('user_id' in result,false);assert.equal('sales' in result,false);
});
test('business card rejects unsafe chat links and image payloads',()=>{
  for(const kakaoUrl of ['javascript:alert(1)','https://evil.test','https://open.kakao.com.evil.test','https://user@open.kakao.com'])assert.throws(()=>normalizeCard({...valid,kakaoUrl}));
  assert.throws(()=>normalizeCard({...valid,photo:'data:image/svg+xml;base64,abc'}));
  assert.equal(normalizeCard({...valid,kakaoUrl:'https://open.kakao.com/o/example'}).kakaoUrl,'https://open.kakao.com/o/example');
});
test('business card escapes HTML and vCard field injection',()=>{
  assert.equal(escapeCardHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  const vcf=cardVcf({...valid,name:'Name\nTEL:123;test'});
  assert.ok(vcf.includes('FN:Name\\nTEL:123\\;test'));
  assert.equal(vcf.split('\r\n').filter(line=>line.startsWith('TEL')).length,1);
});
test('business card validates required fields and limits',()=>{
  assert.throws(()=>normalizeCard({...valid,name:''}));
  assert.throws(()=>normalizeCard({...valid,phone:'not a phone'}));
  assert.throws(()=>normalizeCard({...valid,introduction:'a'.repeat(3001)}));
});
test('career is restored below the introduction and outside the compact identity box',()=>{
  const html=businessCardPage({...valid,branch:'의정부 본사',career:'경매 상담 경력\n\n투자 분석 <전문>\r\n',specialties:'고객 신뢰'},'https://example.test/card/demo');
  assert.ok(!html.includes('identity-career'));
  assert.ok(html.indexOf('EXPERIENCE') > html.indexOf('YOUR TRUSTED PARTNER'));
  assert.ok(html.indexOf('EXPERIENCE') < html.indexOf('>CONTACT<'));
  assert.ok(html.includes('투자 분석 &lt;전문&gt;'));
  assert.ok(!businessCardPage({...valid,career:' \n '},'',true).includes('EXPERIENCE'));
  assert.ok(html.includes('min-height:0;margin:20px 24px;padding:14px 20px 12px'));
  assert.ok(html.includes('--portrait-height:620px'));
  assert.ok(html.includes('font-size:26px;font-weight:700'));
  assert.ok(html.includes('font-size:16px;font-weight:500'));
  assert.ok(html.includes('font-size:12px;font-weight:400'));
});
test('registration defaults populate department, position and headquarters without inventing specialties',()=>{
  const card=registrationCard({name:'백재원',department:'경매사업부 1팀',position_title:'팀장',branch:'의정부'});
  assert.equal(card.name,'백재원');assert.equal(card.department,'경매사업부 1팀');assert.equal(card.title,'팀장');assert.equal(card.branch,'의정부 본사');assert.equal(card.specialties,'');
  assert.ok(card.introduction.includes('부동산 경매'));
  assert.ok(card.career.includes('상담 안내'));
  assert.equal(syncCardProfile({...card,introduction:'직접 작성',career:''},{name:'백재원'}).introduction,'직접 작성');
  assert.equal(syncCardProfile({...card,career:''},{name:'백재원'}).career,'');
});
test('mobile manager places delivery above metrics and editor, and offers camera capture separately',()=>{
  const css=readFileSync(new URL('../src/react-app/pages/BusinessCard.css',import.meta.url),'utf8');
  const page=readFileSync(new URL('../src/react-app/pages/BusinessCard.tsx',import.meta.url),'utf8');
  assert.ok(css.includes('@media(max-width:768px)'));
  assert.ok(css.includes('.bc-delivery{order:1}.bc-metrics{order:2}'));
  assert.ok(css.includes('.bc-editor{order:4}.bc-preview{order:5}'));
  assert.ok(page.includes('accept="image/*" capture="user"'));
  assert.ok(page.includes('사진첩 · 파일 선택'));
  assert.ok(page.includes('bc-panel bc-delivery'));
});
test('card management has accessible interaction and busy feedback',()=>{
  const css=readFileSync(new URL('../src/react-app/pages/BusinessCard.css',import.meta.url),'utf8');
  const page=readFileSync(new URL('../src/react-app/pages/BusinessCard.tsx',import.meta.url),'utf8');
  assert.ok(css.includes('button:not(:disabled):active'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('.bc-feedback{position:fixed'));
  assert.ok(page.includes('className="bc-feedback" role="status" aria-live="polite"'));
  assert.ok(page.includes('window.clearTimeout(timer)'));
});
test('management manual download points to the original user guide PDF',()=>{
  const page=readFileSync(new URL('../src/react-app/pages/BusinessCard.tsx',import.meta.url),'utf8');
  assert.ok(page.includes('href="/manuals/business-card-user-guide.pdf" download="마이옥션_전자명함_사용설명서.pdf"'));
  const pdf=readFileSync(new URL('../public/manuals/business-card-user-guide.pdf',import.meta.url));
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(pdf.length>10000);
});
test('legacy cards default to navy and reject arbitrary CSS colors',()=>{
  const {department,branch,boxColor,...legacy}=valid;
  assert.equal(normalizeCard(legacy).boxColor,'navy');
  assert.throws(()=>normalizeCard({...valid,boxColor:'red; background:url(evil)'}));
});
test('five palettes display matching logo and tags with reduced transparency',()=>{
  assert.equal(Object.keys(cardColors).length,5);
  assert.equal(normalizeCard({...valid,boxColor:'orange'}).boxColor,'navy');
  for(const [boxColor,theme] of Object.entries(cardColors)){
    const html=businessCardPage({...valid,boxColor,department:'경매사업부 1팀',title:'팀장',branch:'의정부 본사',specialties:'고객 신뢰, 투자전문, 문제 해결사'},'https://example.test/card/demo');
    assert.ok(html.includes(`/brand/myauction-logo-${theme.logo}.png`));
    assert.ok(html.includes(`background:rgba(${theme.rgb},.8)`));
    assert.ok(html.includes('경매사업부 1팀 ㅣ 팀장'));
    assert.ok(html.includes('<p>의정부 본사</p>'));
    assert.ok(html.includes('<div class="identity-tags"><span>고객 신뢰</span><span>투자전문</span><span>문제 해결사</span></div>'));
    assert.ok(!html.includes('SPECIALTIES'));
  }
});
test('optional social links are validated, escaped, and displayed without raw addresses',()=>{
  for(const url of ['javascript:alert(1)','https://instagram.com.evil.test/a','https://user@instagram.com/a','http://instagram.com/a'])assert.throws(()=>normalizeCard({...valid,instagramUrl:url}));
  assert.throws(()=>normalizeCard({...valid,blogUrl:'https://naver.com'}));
  const card=normalizeCard({...valid,instagramUrl:'https://www.instagram.com/test',blogUrl:'https://blog.naver.com/test',youtubeUrl:'https://www.youtube.com/@test'});
  const html=businessCardPage(card,'https://example.test/card/abcd2345');
  assert.ok(html.includes('aria-label="SNS 바로가기"'));
  assert.equal((html.match(/class="social-link"/g)||[]).length,3);
  assert.ok(html.includes('href="https://blog.naver.com/test"'));
  assert.ok(!html.includes('>https://'));
  assert.ok(!businessCardPage(valid,'').includes('aria-label="SNS 바로가기"'));
});
test('public footer is removed and social shortcuts are compact right-aligned logo buttons',()=>{
  const html=businessCardPage({...valid,youtubeUrl:'https://www.youtube.com/@test'},'');
  assert.ok(!html.includes('<footer>'));
  assert.ok(!html.includes('방문 및 버튼 클릭을 익명 식별자로 집계합니다.'));
  assert.ok(!html.includes('방문자는 기기·브라우저 기준 추정치입니다.'));
  assert.ok(html.includes('justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 20px'));
  assert.ok(html.includes('width:44px;height:44px'));
  assert.ok(html.includes('aria-label="YouTube 바로가기 (새 창)"'));
  assert.ok(!html.includes('<span>YouTube</span>'));
});
test('one optional video is placed between portrait and intro; invalid embeds are rejected',()=>{
  for(const url of ['https://youtu.be/abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com/shorts/abcdefghijk'])assert.equal(youtubeVideoId(url),'abcdefghijk');
  for(const url of ['https://evil.test/abcdefghijk','https://youtube.com/@channel','https://youtube.com/playlist?list=abc','javascript:alert(1)'])assert.throws(()=>normalizeCard({...valid,videoUrl:url}));
  const html=businessCardPage({...valid,videoUrl:'https://youtu.be/abcdefghijk'},'');
  assert.equal((html.match(/<iframe /g)||[]).length,1);
  assert.ok(html.indexOf('aria-label="소개 영상"')>html.indexOf('class="hero"'));
  assert.ok(html.indexOf('aria-label="소개 영상"')<html.indexOf('YOUR TRUSTED PARTNER'));
  assert.ok(html.includes('https://www.youtube-nocookie.com/embed/abcdefghijk'));
  assert.ok(!businessCardPage(valid,'').includes('<iframe '));
});
test('short codes are eight readable characters',()=>{
  for(let i=0;i<50;i++)assert.match(newCardCode(),/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
});
test('SMS closing-bracket correction accepts only complete card identifiers',()=>{
  assert.equal(cardLinkWithoutClosingBracket('e76u8dxh]'),'e76u8dxh');
  assert.equal(cardLinkWithoutClosingBracket('e8c0393e-5107-45de-aae5-78b236deed9e]'),'e8c0393e-5107-45de-aae5-78b236deed9e');
  for(const value of ['e76u8dxh','https://evil.test]','../admin]','unknown]','e76u8dxh/anything]'])assert.equal(cardLinkWithoutClosingBracket(value),null);
});
test('short links are stable, unique, preserve legacy links and respect publication status',async()=>{
  const db=new Database(':memory:');
  try{
    db.exec(readFileSync(new URL('../d1/migrate-business-cards.sql',import.meta.url),'utf8'));
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,approved INTEGER,role TEXT); INSERT INTO users VALUES('owner',1,'member'),('other',1,'member')");
    db.prepare('INSERT INTO business_cards(user_id,slug,draft,published) VALUES(?,?,?,?)').run('owner','legacy-uuid','{}','{}');
    db.prepare('INSERT INTO business_cards(user_id,slug,draft,published) VALUES(?,?,?,?)').run('other','other-uuid','{}','{}');
    const adapter={prepare:(sql:string)=>({bind:(...args:unknown[])=>({first:async()=>db.prepare(sql).get(...args),run:async()=>db.prepare(sql).run(...args)})})} as unknown as Parameters<typeof ensureCardShortLink>[0];
    const code=await ensureCardShortLink(adapter,'legacy-uuid');
    assert.equal(await ensureCardShortLink(adapter,'legacy-uuid'),code);
    assert.notEqual(await ensureCardShortLink(adapter,'other-uuid'),code);
    for(const address of [code,'legacy-uuid'])assert.equal((db.prepare(publishedCardSql).get(address,address) as {slug:string}).slug,'legacy-uuid');
    db.prepare('UPDATE business_cards SET published=NULL WHERE user_id=?').run('owner');
    assert.equal(db.prepare(publishedCardSql).get(code,code),undefined);
    db.prepare('UPDATE users SET role=? WHERE id=?').run('resigned','other');
    const other=await ensureCardShortLink(adapter,'other-uuid');
    assert.equal(db.prepare(publishedCardSql).get(other,other),undefined);
  }finally{db.close()}
});
test('public card renders escaped metadata and syntactically valid interaction script',()=>{
  const html=businessCardPage({...valid,name:'</script><script>alert(1)</script>',photo:'data:image/jpeg;base64,/9j/AA=='},'https://example.test/card/demo');
  assert.ok(html.includes('property="og:image" content="https://example.test/card/demo/photo"'));
  assert.ok(html.includes('property="og:image:type" content="image/jpeg"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Function(scripts[0][1]));
  assert.ok(html.includes('카카오톡 상담'));
});
test('mobile contact dock remains compact, has reserved bottom space and readable email labels',()=>{
  const html=businessCardPage({...valid,email:'long.email.address@example.com',instagramUrl:'https://www.instagram.com/test',blogUrl:'https://blog.naver.com/test'},'');
  assert.ok(html.includes('.dock{z-index:100;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)'));
  assert.ok(html.includes('height:44px;padding:0 8px'));
  assert.ok(html.includes('font-size:clamp(12px,3.5vw,15px);line-height:1.2;white-space:nowrap'));
  assert.ok(html.includes('main{padding-bottom:calc(84px + env(safe-area-inset-bottom,0px))}'));
  assert.ok(html.includes('class="contact-email"'));
  assert.ok(html.includes('.contact>span:first-child{flex:0 0 auto;white-space:nowrap}'));
  assert.ok(!html.includes('카카오톡 상담하기'));
  assert.ok(html.includes('card-instagram-gradient'));
  assert.ok(html.includes('>blog</text>'));
});
test('card migration is idempotent and deduplicates repeat events',()=>{
  const db=new Database(':memory:');
  try{
    const migration=readFileSync(new URL('../d1/migrate-business-cards.sql',import.meta.url),'utf8');
    db.exec(migration);db.exec(migration);
    const insert=db.prepare('INSERT OR IGNORE INTO business_card_events(slug,visitor,kind,bucket) VALUES(?,?,?,?)');
    insert.run('one','visitor','visit',1);insert.run('one','visitor','visit',1);insert.run('two','visitor','visit',1);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM business_card_events WHERE slug=?').get('one') as {n:number}).n,1);
  }finally{db.close()}
});
