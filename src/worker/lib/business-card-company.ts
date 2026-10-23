import { escapeCardHtml as e } from '../../shared/business-card.ts';

// Company-wide copy supplied by the owner; not editable in individual cards.
export const companyServices = [
  {title:'경매물건 선정',start:'#ec008c',end:'#ff4c13',ink:'#c40068',lead:'고객님께서 원하시는 물건은 경매전문 컨설턴트가 ‘직접’ 찾아드립니다.',body:'희망지역 / 금액대 / 물건종류 등 조건에 맞는 물건을 분석하여 고객님께 담당 컨설턴트가 제안해드립니다.'},
  {title:'권리분석',start:'#ff8700',end:'#f4cc00',ink:'#a84e00',lead:'다각적 권리분석을 통해 입찰여부를 가려드립니다!',body:'법적 하자여부, 말소되지 않는 권리, 선순위 임차인, 유치권 등을 다각적으로 분석하여 입찰여부를 가려드립니다.'},
  {title:'현장조사(임장)',start:'#009cff',end:'#0027a8',ink:'#0064ba',lead:'마이옥션 경매전문 컨설턴트는 ‘직접’ 현장임장을 다녀옵니다!',body:'모든 사건에는 ‘현장에 답이 있습니다.’ 수많은 물건을 다뤄온 20년 경력의 컨설턴트가 현장을 직접 확인하여 정확한 정보를 제공합니다.'},
  {title:'입찰가분석 및 시세조사',start:'#ff3500',end:'#ff9300',ink:'#ba3a00',lead:'고객님께 가장 ‘합리적인’ 입찰가를 제안드립니다!',body:'권리분석과 현장조사를 바탕으로 향후 투자전망과 목표수익률을 제시하고, 예상소요비용 등을 계산하여 가장 합리적인 입찰금액을 제안드립니다.'},
  {title:'입찰대행',start:'#009c4c',end:'#24c582',ink:'#007747',lead:'법원에 동행하여 경매입찰 필요서류를 점검하고 입찰표 작성을 도와드립니다.',body:'입찰표 작성이 미비하여 낙찰이 무효되는 사례를 방지하고, 담당 컨설턴트가 법원에 동행하여 입찰 전 과정을 지원합니다.'},
  {title:'잔금대출',start:'#006adb',end:'#1930ac',ink:'#075ab6',lead:'‘입찰 전’에 낙찰대금의 대출여부와 가능금액, 이자율 등을 검토 후 안내드립니다.',body:'낙찰 후 잔금대출 문제로 어려움을 겪지 않도록 다양한 금융상품을 사전에 검토하여 안내드립니다.'},
  {title:'명도 및 사후관리',start:'#9235b0',end:'#6844cd',ink:'#8131ad',lead:'마이옥션의 제휴 법무법인 명승의 전속고문을 통해 ‘명도까지 깔끔하게’ 경매 마무리를 도와드립니다.',body:'명도절차 진행부터 잔존 이해관계인 협의까지 경매 완료 후에도 안정적인 사후관리를 지원합니다.'},
] as const;

export function companyIntroduction(customImage = ''): string {
  if(customImage) return `<section class="company-custom" aria-label="회사소개"><button type="button" class="company-fee-image-link company-zoom-trigger" aria-label="회사소개 이미지 확대"><img class="company-fee-image" src="${e(customImage)}" alt="담당자가 등록한 회사소개 이미지" loading="lazy"></button></section>`;
  return `<section class="company-carousel" aria-label="마이옥션 회사소개" aria-roledescription="슬라이드"><div class="company-slide" id="company-slide-1" role="group" aria-label="1 / 2 · 올인원 서비스"><section class="company-intro" aria-labelledby="company-heading">
    <header class="company-header"><span>MY AUCTION · ALL IN ONE</span><h2 id="company-heading">경매의 시작부터 마무리까지</h2><p>번호를 누르면 해당 서비스의 상세 설명을 볼 수 있습니다.</p></header>
    <div class="company-map"><div class="company-orbit" aria-hidden="true"></div><div class="company-center"><span>마이옥션</span><strong>올인원 서비스</strong><small>ALL IN ONE Service</small></div>
    ${companyServices.map((s,i)=>`<button type="button" id="company-step-${i+1}" class="company-step company-step-${i+1}" style="--step-start:${s.start};--step-end:${s.end}" aria-label="${s.title}" aria-expanded="false" aria-controls="company-detail-${i+1}"><span class="company-number">${i+1}</span><span>${i===3?'입찰가분석<br>및 시세조사':i===6?'명도 및<br>사후관리':s.title}</span></button>`).join('')}</div>
    <div class="company-details">${companyServices.map((s,i)=>`<section hidden id="company-detail-${i+1}" class="company-detail" role="region" aria-labelledby="company-step-${i+1}" style="--step-ink:${s.ink};--step-start:${s.start};--step-end:${s.end}"><div class="company-detail-head"><span>${i+1}</span><h3>${s.title}</h3><button type="button" class="company-detail-close" aria-label="${s.title} 설명 닫기">×</button></div><p class="company-lead">${e(s.lead)}</p><p>${e(s.body)}</p></section>`).join('')}</div>
  </section></div><div class="company-slide" id="company-slide-2" hidden role="group" aria-label="2 / 2 · 컨설팅 수수료"><button type="button" class="company-fee-image-link company-zoom-trigger" aria-label="컨설팅 수수료 안내 확대"><img class="company-fee-image" src="/brand/company-consulting-fees.png" width="1490" height="1056" alt="마이옥션 컨설팅 수수료 안내: 일반회원은 감정가 1% 또는 낙찰가 1.5% 중 낮은 금액, VIP는 감정가 0.8% 또는 낙찰가 1% 중 낮은 금액. 최저수수료 200만원. 최초 1회 계약비용은 주거용 550,000원, 토지·상업용 1,100,000원, VIP 2,200,000원이며 VAT 포함." loading="lazy"></button></div>
  <nav class="company-carousel-controls" aria-label="회사소개 페이지 이동"><button type="button" class="company-prev" aria-label="이전 회사소개 페이지" aria-controls="company-slide-1 company-slide-2">‹</button><span class="company-page-label" aria-live="polite" aria-atomic="true">1 / 2 · 올인원 서비스</span><button type="button" class="company-next" aria-label="다음 회사소개 페이지" aria-controls="company-slide-1 company-slide-2">›</button></nav></section>`;
}

export const companyIntroductionCss = `
.company-carousel{max-width:560px;width:calc(100% - 40px);margin:24px auto;border:1px solid #dce5ef;border-radius:18px;overflow:hidden;background:white;box-shadow:0 8px 26px #17345b10}
.company-slide{height:auto;overflow:visible}.company-slide[hidden],.company-detail[hidden]{display:none}
.company-intro{padding:0;background:radial-gradient(ellipse at center,#f4f6fa 0%,#fff 72%);color:#131c35}
.company-header{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.company-map{position:relative;width:100%;aspect-ratio:1490/1060;container-type:inline-size}
.company-orbit{position:absolute;left:31.5%;top:21.5%;width:37%;aspect-ratio:1;border:1px dashed #9095a1;border-radius:50%}
.company-center{position:absolute;left:35.5%;top:28%;width:29%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;flex-direction:column;border-radius:50%;border:.65cqw solid transparent;background:linear-gradient(white,white) padding-box,conic-gradient(#ffc000,#0068ec,#ff7d00,#00b768,#1735b2,#9235b0,#ec008c,#ffc000) border-box;box-shadow:0 1.2cqw 2cqw #1b304b18;line-height:1.5}
.company-center{text-align:center;gap:.3cqw}.company-center>span{font-size:3.6cqw;font-weight:700;line-height:1.2}.company-center strong{font-size:4.25cqw;font-weight:800;letter-spacing:-.2cqw;white-space:nowrap;line-height:1.3}.company-center small{font-size:2.25cqw;font-weight:500;color:#35435c;white-space:nowrap;line-height:1.4}
.company-intro .company-step{position:absolute;display:flex;align-items:center;gap:.9cqw;width:28%;height:12.7%;padding:.6cqw .8cqw;border-radius:10cqw;background:linear-gradient(110deg,var(--step-start),var(--step-end));color:white;font-size:2.65cqw;font-weight:700;line-height:1.15;text-align:center;box-shadow:0 1.3cqw 1.6cqw #1b304b30;border:0;cursor:pointer}
.company-step>span:last-child{flex:1;white-space:nowrap;display:block;text-align:center;font-size:2.85cqw;line-height:1.2;letter-spacing:-.08cqw}.company-step-3>span:last-child{font-size:2.6cqw}.company-number{display:grid;place-items:center;border:.55cqw solid white;border-radius:50%;width:7.4cqw;height:7.4cqw;flex:none;font-size:5.5cqw;font-weight:700;line-height:1}
.company-intro .company-step-1{left:14.7%;top:12.4%}.company-intro .company-step-2{left:57%;top:12.4%}.company-intro .company-step-3{left:70%;top:36.6%;font-size:2.4cqw}.company-intro .company-step-4{left:66%;top:60.5%}.company-intro .company-step-5{left:36.5%;top:76.2%}.company-intro .company-step-6{left:6.3%;top:60.5%}.company-intro .company-step-7{left:2.4%;top:36.6%;width:27%}
.company-intro .company-step[aria-expanded=true]{outline:2px solid var(--step-start);outline-offset:3px}.company-step:focus-visible,.company-detail-close:focus-visible{outline:3px solid #152a47;outline-offset:3px}
.company-detail{margin:0 12px 14px;background:white;border:1px solid #e1e7ef;border-top:4px solid var(--step-start);border-radius:16px;box-shadow:0 8px 20px #14284a15;padding:16px}.company-detail-head{display:flex;align-items:center;gap:10px}.company-detail-head>span{background:linear-gradient(110deg,var(--step-start),var(--step-end));color:white;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;font-size:21px;font-weight:700;flex:none}.company-detail h3{margin:0;font-size:17px;line-height:1.4}.company-intro .company-detail-close{margin-left:auto;padding:0;min-width:44px;min-height:44px;background:#edf2f8;color:#344862;font-size:26px}.company-detail p{font-size:14px;line-height:1.8;color:#3b495f;margin:10px 0 0;overflow-wrap:anywhere}.company-detail .company-lead{font-size:16px;font-weight:700;color:var(--step-ink);line-height:1.6}
.company-fee-image-link{display:block;width:100%;padding:0;border:0;border-radius:0;line-height:0;background:white;cursor:zoom-in}.company-fee-image{display:block;width:100%;height:auto;object-fit:contain}.company-custom{max-width:560px;width:calc(100% - 40px);margin:24px auto;border-radius:18px;overflow:hidden;border:1px solid #dce5ef}
.company-zoom-dialog{padding:0;border:0;border-radius:14px;width:min(1490px,96vw);max-width:96vw;max-height:94dvh;background:#fff;overflow:auto}.company-zoom-dialog::backdrop{background:#0b1425cc}.company-zoom-toolbar{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#fff;z-index:1;color:#18304d}.company-zoom-close{min-width:44px;min-height:44px;font-size:25px;padding:0}.company-zoom-dialog img{display:block;width:100%;height:auto}.company-zoom-trigger:focus-visible{outline:3px solid #296cb8;outline-offset:-3px}
.company-carousel-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #e4eaf2;padding:6px 10px;background:#f5f8fc}.company-carousel-controls button{width:44px;height:44px;padding:0;font-size:30px;line-height:1;background:white;border:1px solid #d6e1ed;color:#203f64}.company-page-label{font-size:12px;color:#415672}.company-carousel-controls button:focus-visible{outline:3px solid #296cb8;outline-offset:2px}
@media(max-width:420px){.company-carousel{width:calc(100% - 28px);margin:18px auto}}
@media(prefers-reduced-motion:no-preference){.company-detail:not([hidden]){animation:company-open .2s ease-out}@keyframes company-open{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}
`;

export const companyImageDialog = `<dialog class="company-zoom-dialog" id="company-zoom-dialog" aria-label="회사소개 이미지 확대"><div class="company-zoom-toolbar"><span>이미지 확대</span><button type="button" class="company-zoom-close" aria-label="확대 이미지 닫기">×</button></div><img alt="확대된 회사소개 이미지"></dialog>`;
export const companyImageZoomScript = `
const imageDialog=document.getElementById('company-zoom-dialog');
if(imageDialog){
  document.querySelectorAll('.company-zoom-trigger').forEach(button=>button.addEventListener('click',()=>{const image=button.querySelector('img');const large=imageDialog.querySelector('img');large.src=image.src;large.alt=image.alt;imageDialog.showModal()}));
  imageDialog.querySelector('.company-zoom-close').addEventListener('click',()=>imageDialog.close());
  imageDialog.addEventListener('click',event=>{if(event.target===imageDialog){const box=imageDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)imageDialog.close()}});
}
`;

export const companyCarouselScript = `
document.querySelectorAll('.company-carousel').forEach(root=>{
  const slides=Array.from(root.querySelectorAll('.company-slide'));
  const label=root.querySelector('.company-page-label');let current=0;
  function show(index){current=(index+slides.length)%slides.length;slides.forEach((slide,i)=>{slide.hidden=i!==current});slides[current].scrollTop=0;label.textContent=(current+1)+' / '+slides.length+' · '+(current===0?'올인원 서비스':'컨설팅 수수료')}
  root.querySelector('.company-prev').addEventListener('click',()=>show(current-1));
  root.querySelector('.company-next').addEventListener('click',()=>show(current+1));
});
`;

export const companyIntroductionScript = `
document.querySelectorAll('.company-intro').forEach(root=>{
  const buttons=Array.from(root.querySelectorAll('.company-step'));
  const panels=Array.from(root.querySelectorAll('.company-detail'));
  function closeAll(){buttons.forEach(button=>button.setAttribute('aria-expanded','false'));panels.forEach(panel=>panel.hidden=true)}
  buttons.forEach(button=>button.addEventListener('click',()=>{
    const wasOpen=button.getAttribute('aria-expanded')==='true';closeAll();
    if(!wasOpen){button.setAttribute('aria-expanded','true');const panel=panels.find(item=>item.id===button.getAttribute('aria-controls'));if(panel){panel.hidden=false;panel.scrollIntoView?.({block:'nearest',behavior:'auto'})}}
  }));
  root.querySelectorAll('.company-detail-close').forEach(close=>close.addEventListener('click',()=>{const active=buttons.find(button=>button.getAttribute('aria-expanded')==='true');closeAll();active?.focus()}));
});
`;
