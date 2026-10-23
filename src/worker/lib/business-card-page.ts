import { blankCard, cardColors, formatCardPhone, youtubeVideoId, escapeCardHtml as e, type BusinessCard } from '../../shared/business-card.ts';
import { cardSocialLinks } from './business-card-social.ts';
import { companyIntroduction, companyIntroductionCss, companyIntroductionScript, companyCarouselScript, companyImageDialog, companyImageZoomScript } from './business-card-company.ts';

export function businessCardPage(card: BusinessCard, base: string, preview = false): string {
  card = {...blankCard, ...card, phone:formatCardPhone(card.phone || '')};
  const theme = cardColors[card.boxColor as keyof typeof cardColors] || cardColors.navy;
  const photo = preview ? card.photo : `${base}/photo`;
  let videoId='';try{videoId=youtubeVideoId(card.videoUrl)}catch{ /* Ignore invalid legacy URLs. */ }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(card.name)} · 마이옥션 전자명함</title>
  <meta name="robots" content="noindex,nofollow"><meta property="og:site_name" content="마이옥션"><meta name="description" content="${e(card.headline)}"><meta property="og:type" content="profile"><meta property="og:title" content="${e(card.name)} · ${e(card.title)}"><meta property="og:description" content="${e(card.headline)}"><meta property="og:url" content="${e(base)}">${card.photo ? `<meta property="og:image" content="${e(photo)}"><meta property="og:image:secure_url" content="${e(photo)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:alt" content="${e(card.name)} 프로필 사진"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${e(photo)}"><meta name="twitter:title" content="${e(card.name)} · ${e(card.title)}">` : ''}
  <style>*{box-sizing:border-box}body{margin:0;background:#edf1f6;color:#18283e;font-family:Arial,'Malgun Gothic',sans-serif;line-height:1.75}main{max-width:660px;margin:auto;background:#fff;min-height:100vh;padding-bottom:110px}.brand{padding:22px 28px;font-weight:800;letter-spacing:3px;font-size:14px}.hero{position:relative;background:linear-gradient(145deg,#dce4ed,#abbcd0);min-height:460px;display:flex;align-items:end}.hero img{width:100%;height:530px;object-fit:cover;object-position:50% 30%}.placeholder{height:430px;width:100%;display:grid;place-items:center;font-size:100px;color:#687f9a}.identity{position:absolute;bottom:22px;left:24px;right:24px;background:rgba(15,35,62,.93);color:#fff;padding:24px;border-radius:16px}.identity h1{font-size:32px;margin:0}.identity p{margin:4px 0;color:#dae5f3}.section{padding:30px;border-bottom:1px solid #e5eaf1}.eyebrow{font-size:12px;font-weight:bold;letter-spacing:2px;color:#5b7392}h2{font-size:26px;line-height:1.5;margin:12px 0 18px}h3{font-size:19px;margin:8px 0 18px}.copy{white-space:pre-line;color:#44556d}.tags{display:flex;gap:8px;flex-wrap:wrap}.tags span{padding:7px 13px;background:#edf2f8;border-radius:30px;color:#304c70}a{color:inherit;text-decoration:none}.contact{display:flex;justify-content:space-between;gap:12px;padding:15px 0;border-bottom:1px solid #edf1f5;overflow-wrap:anywhere}button,.button{font:inherit;border:0;border-radius:12px;padding:14px 18px;cursor:pointer;background:#eaf0f7;color:#203c60;font-weight:bold}.save{width:100%;margin-top:20px}.dock{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(100%,660px);display:flex;gap:10px;padding:14px 20px calc(14px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);box-shadow:0 -4px 25px #18283e12}.dock a,.dock button{flex:1;text-align:center}.phone{background:#183c64;color:white}.kakao{background:#fee500;color:#302522}footer{font-size:12px;text-align:center;color:#708098;padding:26px}dialog{border:0;border-radius:18px;max-width:90%;padding:28px;color:#20334d}dialog::backdrop{background:#13203399}.preview{background:#e9bc61;color:#312717;text-align:center;padding:8px;font-size:13px}@media(prefers-reduced-motion:no-preference){.identity{animation:enter .65s ease-out}@keyframes enter{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}}</style></head><body>
  <style>
  .hero{--portrait-height:620px;min-height:var(--portrait-height)}
  .hero>img,.hero>.placeholder{position:absolute;inset:0;height:100%;width:100%}
  .identity{position:relative;left:auto;right:auto;bottom:auto;z-index:1;width:calc(100% - 48px);min-height:0;margin:20px 24px;padding:14px 20px 12px;background:rgba(${theme.rgb},.8);color:${theme.ink};backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);border:1px solid rgba(255,255,255,.22)}
  .identity-top{position:relative;padding-right:114px;margin-bottom:4px;min-height:52px}
  .identity-top h1{font-size:26px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
  .hero .identity-logo{position:absolute;right:0;top:0;width:98px;height:auto;max-height:52px;object-fit:contain}
  .identity p{margin:2px 0;font-size:16px;font-weight:500;line-height:1.4;color:inherit;overflow-wrap:anywhere}
  .identity-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .identity-tags span{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:4px 9px;font-size:12px;font-weight:400;line-height:1.4;color:inherit;overflow-wrap:anywhere;max-width:100%}
  .card-video{width:100%;aspect-ratio:16/9;min-height:200px;background:#132239;display:grid;place-items:center;color:white;text-align:center}.card-video iframe{display:block;width:100%;height:100%;border:0;min-height:200px}.card-video p{padding:20px}.social-links{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 20px;border-bottom:1px solid #e5eaf1}.social-link{display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;color:#344862}.social-link svg{display:block;width:36px;height:36px}.social-link:focus-visible{outline:3px solid #2466ac;outline-offset:2px;border-radius:6px}
  html{scroll-padding-bottom:calc(84px + env(safe-area-inset-bottom,0px))}
  button,.button,.social-link{transition:filter .15s ease,box-shadow .15s ease}
  @media(hover:hover) and (pointer:fine){button:hover,.button:hover,.social-link:hover{filter:brightness(1.08);box-shadow:0 4px 12px #15345430}}
  button:active,.button:active,.social-link:active{filter:brightness(.88);box-shadow:inset 0 2px 5px #102b4940}
  button:focus-visible,.button:focus-visible{outline:3px solid #7aa5d1;outline-offset:3px}
  @media(prefers-reduced-motion:reduce){button,.button,.social-link{transition:none}}
  main{padding-bottom:calc(84px + env(safe-area-inset-bottom,0px))}
  .dock{z-index:100;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding:8px max(12px,env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));border-top:1px solid #dce4ee}
  .dock a,.dock button{display:flex;align-items:center;justify-content:center;min-width:0;height:44px;padding:0 8px;border-radius:10px;font-size:clamp(12px,3.5vw,15px);line-height:1.2;white-space:nowrap}
  .contact{align-items:baseline;min-width:0;gap:12px}
  .contact>span:first-child{flex:0 0 auto;white-space:nowrap}
  .contact>strong,.contact>.contact-email{min-width:0;text-align:right;overflow-wrap:anywhere}
  .contact-email{font-size:clamp(12px,3.5vw,16px);line-height:1.5}
  .save-help{margin:10px 0 0;color:#536880;font-size:12px;line-height:1.6}
  @media(max-width:420px){.identity{width:calc(100% - 32px);margin-left:16px;margin-right:16px;padding:12px 16px 10px}.identity-top{padding-right:98px;min-height:46px}.identity-top h1{font-size:24px}.identity p{font-size:15px}.hero .identity-logo{width:86px;max-height:46px}.identity-tags span{padding:4px 7px}.section{padding:24px 20px}}
  ${companyIntroductionCss}
  </style>
  <main>${preview ? '<div class="preview">미리보기 · 방문 및 클릭이 집계되지 않습니다</div>' : ''}<div class="brand">MY AUCTION <span style="font-weight:400;letter-spacing:0">| PROFESSIONAL</span></div>
  <div class="hero">${card.photo ? `<img src="${e(photo)}" alt="${e(card.name)} 프로필 사진">` : `<div class="placeholder" aria-hidden="true">${e(card.name.slice(0,1))}</div>`}<div class="identity"><div class="identity-top"><h1>${e(card.name)}</h1><img class="identity-logo" src="/brand/myauction-logo-${theme.logo}.png" alt="마이옥션 · 모두의 부동산경매"></div><p>${[card.department,card.title].filter(Boolean).map(e).join(' ㅣ ')}</p>${card.branch ? `<p>${e(card.branch)}</p>` : ''}${card.specialties ? `<div class="identity-tags">${card.specialties.split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span>${e(s)}</span>`).join('')}</div>` : ''}</div></div>
  ${videoId ? `<section class="card-video" aria-label="소개 영상">${preview ? '<p>유튜브 소개 영상 1편이 이 위치에 표시됩니다.<br>영상 재생은 공개 명함에서 확인해 주세요.</p>' : `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="${e(card.name)} 소개 영상" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>`}</section>` : ''}
  <section class="section"><div class="eyebrow">YOUR TRUSTED PARTNER</div><h2>${e(card.headline)}</h2><div class="copy">${e(card.introduction)}</div></section>
  ${card.career.trim() ? `<section class="section"><div class="eyebrow">EXPERIENCE</div><h3>경력과 약력</h3><div class="copy">${e(card.career)}</div></section>` : ''}
  <section class="section"><div class="eyebrow">CONTACT</div><h3>편하게 연락해 주세요</h3><a class="contact" data-event="phone" href="tel:${e(card.phone.replace(/[^+\d]/g,''))}"><span>휴대전화</span><strong>${e(card.phone)} ↗</strong></a>${card.email ? `<div class="contact"><span>이메일</span><span class="contact-email">${e(card.email)}</span></div>` : ''}<button class="save" id="save">＋ 연락처 저장</button><p class="save-help">연락처 추가 화면에서 저장을 눌러 주세요. 파일이 다운로드되면 contact.vcf를 열거나 연락처 앱에서 가져오기를 선택하세요.</p></section>
  ${cardSocialLinks(card)}
  ${card.companyHidden === 'yes' ? '' : companyIntroduction(card.companyImage)}
  </main>
  ${card.companyHidden === 'yes' ? '' : companyImageDialog}
  <div class="dock"><a class="button phone" data-event="phone" href="tel:${e(card.phone.replace(/[^+\d]/g,''))}">전화 상담</a>${card.kakaoUrl ? `<a class="button kakao" data-event="kakao" href="${e(card.kakaoUrl)}" target="_blank" rel="noopener noreferrer">카카오톡 상담</a>` : '<button class="kakao" id="kakao">카카오톡 상담</button>'}</div>
  <dialog id="help"><h3>카카오톡으로 상담하기</h3><p>담당자 번호: <strong>${e(card.phone)}</strong></p><p>카카오톡에서 전화번호로 친구를 추가해 주세요.<br>담당자의 친구 추가 허용 설정에 따라 검색되지 않을 수 있습니다.</p><button id="copy">번호 복사</button> <button id="close">닫기</button><p id="notice" role="status"></p></dialog>
  <script>
  ${companyIntroductionScript}
  ${companyCarouselScript}
  ${companyImageZoomScript}
  const preview=${preview};const base=location.pathname.endsWith('/')?location.pathname.slice(0,-1):location.pathname;
  let visitor;try{visitor=localStorage.getItem('business-card-visitor');if(!visitor){visitor=crypto.randomUUID();localStorage.setItem('business-card-visitor',visitor)}}catch{visitor=crypto.randomUUID()}
  function track(kind){if(preview)return;fetch(base+'/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,visitor}),keepalive:true}).catch(()=>{})}
  if(!preview){let seen=false;try{const k='card-view:'+base;seen=Date.now()-Number(sessionStorage.getItem(k)||0)<1800000;if(!seen)sessionStorage.setItem(k,String(Date.now()))}catch{}if(!seen)track('visit')}
  document.querySelectorAll('[data-event]').forEach(el=>el.addEventListener('click',()=>track(el.dataset.event)));
  document.getElementById('kakao')?.addEventListener('click',()=>{track('kakao');document.getElementById('help').showModal()});
  document.getElementById('close').onclick=()=>document.getElementById('help').close();
  document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#help strong').textContent);document.getElementById('notice').textContent='번호를 복사했습니다.'}catch{document.getElementById('notice').textContent='표시된 번호를 길게 눌러 복사해 주세요.'}};
  document.getElementById('save').onclick=()=>{if(preview){alert('실제 공개 페이지에서 연락처를 저장할 수 있습니다.');return}track('save');location.href=base+'/contact.vcf'};
  </script></body></html>`;
}
