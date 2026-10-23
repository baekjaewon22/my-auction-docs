import { useEffect, useRef, useState } from 'react';
import { Save, Pencil, Trash2, ExternalLink, Download } from 'lucide-react';
import { blankCard, defaultCardWriting, fixedCardFields, cardColors, socialLabels, type SocialField, type BusinessCard as Card } from '../../shared/business-card';
import './BusinessCard.css';
import { defaultCardMessage, renderCardMessage, editCardMessage } from '../../shared/business-card-message';

type Stats = {visits:number;visitors:number;phone:number;kakao:number;saves:number};
type CardOwner = {id:string;name:string;department:string;position_title:string;branch:string;role:string};
async function request(path:string, body?:unknown, method='POST') {
  const response=await fetch('/card/manage/'+path,{method:body===undefined?(method==='POST'?'GET':method):method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('token') || ''}`},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok) { const error=await response.text(); try{throw new Error(JSON.parse(error).error)}catch(e){if(e instanceof SyntaxError)throw new Error('요청에 실패했습니다. 다시 시도해 주세요.');throw e} }
  return response;
}
export default function BusinessCard() {
  const [deliveryTemplate,setDeliveryTemplate]=useState(defaultCardMessage);
  const savedDelivery=useRef(defaultCardMessage);
  const [card,setCard]=useState<Card>({...blankCard});
  const [slug,setSlug]=useState(''); const [published,setPublished]=useState(false);
  const [stats,setStats]=useState<Stats>({visits:0,visitors:0,phone:0,kakao:0,saves:0});
  const [preview,setPreview]=useState(''); const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false); const [ready,setReady]=useState(false);
  const [feedbackVisible,setFeedbackVisible]=useState(false);
  useEffect(()=>{
    if(busy){setFeedbackVisible(true);return;}
    if(!message){setFeedbackVisible(false);return;}
    setFeedbackVisible(true);
    const timer=window.setTimeout(()=>setFeedbackVisible(false),5000);
    return ()=>window.clearTimeout(timer);
  },[busy,message]);
  const [activeSocial,setActiveSocial]=useState<SocialField[]>([]);
  const [socialType,setSocialType]=useState<SocialField>('instagramUrl');
  const [videoEnabled,setVideoEnabled]=useState(false);
  const [isMaster,setIsMaster]=useState(false);const [owners,setOwners]=useState<CardOwner[]>([]);const [selectedOwner,setSelectedOwner]=useState('');const [ownerSearch,setOwnerSearch]=useState('');
  const [editing,setEditing]=useState(false);const [exists,setExists]=useState(false);
  const operationLock=useRef(false);const savedSnapshot=useRef('');
  const ownerPath=(id=selectedOwner)=>'me'+(id?'?user_id='+encodeURIComponent(id):'');
  async function load(id=''){
    if(operationLock.current)return;operationLock.current=true;setBusy(true);setReady(false);setPreview('');setMessage('');setSlug('');setPublished(false);setStats({visits:0,visitors:0,phone:0,kakao:0,saves:0});
    try{const data=await (await request(ownerPath(id))).json();setCard(data.card);setDeliveryTemplate(data.message_template);savedDelivery.current=data.message_template;savedSnapshot.current=JSON.stringify(data.card);setSelectedOwner(data.owner_id);setIsMaster(data.can_select_user);setExists(data.exists);setEditing(!data.exists);setActiveSocial((Object.keys(socialLabels) as SocialField[]).filter(key=>!!data.card[key]));setVideoEnabled(!!data.card.videoUrl);setSlug(data.slug||'');setPublished(data.published);setStats(data.stats);if(data.can_select_user){try{const result=await (await request('users')).json();setOwners(result.users)}catch{setMessage('담당자 목록을 불러오지 못했습니다. 새로고침해 주세요.')}}setReady(true)}catch(e){setCard({...blankCard});setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}
  }
  useEffect(()=>{void load()},[]);
  async function save(action:string){if(operationLock.current||!ready)return;operationLock.current=true;setBusy(true);try{const data=await (await request(ownerPath(),{card,action},'PUT')).json();setSlug(data.slug);setPublished(data.published);setExists(true);setCard(data.card);savedSnapshot.current=JSON.stringify(data.card);if(action==='publish')setEditing(false);setMessage(action==='save'?'초안을 저장했습니다. 공개 명함은 변경되지 않습니다.':action==='publish'?'최종 저장했습니다. 공개 명함에 반영되었습니다.':'명함을 비공개로 전환했습니다.')}catch(e){setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}}
  const publicUrl=slug&&published?`${location.origin}/card/${slug}`:'';
  const deliveryUrl=publicUrl||'명함 공개 후 주소가 자동으로 들어갑니다';
  const deliveryPreview=renderCardMessage(deliveryTemplate,card,deliveryUrl);
  async function copyDelivery(text:string){setMessage('');try{await navigator.clipboard.writeText(text);setMessage('복사했습니다. 문자 또는 카카오톡에 붙여 넣으세요.')}catch{setMessage('복사하지 못했습니다. 아래 내용을 선택해 직접 복사해 주세요.')}}
  async function saveDelivery(){if(operationLock.current||!ready)return;operationLock.current=true;setBusy(true);try{const data=await (await request('message?user_id='+encodeURIComponent(selectedOwner),{template:deliveryTemplate},'PUT')).json();setDeliveryTemplate(data.template);savedDelivery.current=data.template;setMessage('안내 문구를 저장했습니다. 공개 명함과 이미지는 변경되지 않습니다.')}catch(e){setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}}
  async function changeOwner(id:string){if(operationLock.current)return;if((JSON.stringify(card)!==savedSnapshot.current||deliveryTemplate!==savedDelivery.current)&&!window.confirm('저장하지 않은 변경사항을 버리고 담당자를 전환할까요?'))return;await load(id)}
  async function deleteCard(){if(operationLock.current||!isMaster||!exists)return;const name=owners.find(owner=>owner.id===selectedOwner)?.name||card.name;if(!window.confirm(`${name} 담당자의 명함을 삭제할까요? 이미지·초안·방문 통계가 삭제되고 기존 링크는 사용할 수 없습니다. 직원 계정은 삭제되지 않습니다. 이 작업은 되돌릴 수 없습니다.`))return;operationLock.current=true;setBusy(true);let deleted=false;try{await request(ownerPath(),undefined,'DELETE');deleted=true}catch(e){setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}if(deleted){await load(selectedOwner);setMessage('명함과 관련 방문 통계·링크를 삭제했습니다. 직원 계정은 유지됩니다.')}}
  async function showPreview(){if(operationLock.current)return;operationLock.current=true;setBusy(true);try{setPreview(await (await request('preview?user_id='+encodeURIComponent(selectedOwner),card)).text());setMessage('현재 작성 내용으로 미리보기를 갱신했습니다.')}catch(e){setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}}
  async function upload(file?:File, field:'photo'|'companyImage'='photo'){if(!file||operationLock.current)return;operationLock.current=true;setBusy(true);try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('12MB 이하 JPG·PNG·WebP 사진을 선택해 주세요.');const bitmap=await createImageBitmap(file);const scale=Math.min(1,(field==='companyImage'?1600:1000)/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const context=canvas.getContext('2d')!;context.fillStyle='#e6ecf3';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const photo=canvas.toDataURL('image/jpeg',.8);if(photo.length>700000)throw new Error('사진 용량이 큽니다. 더 작은 사진을 선택해 주세요.');setCard(c=>({...c,[field]:photo}));setMessage('사진을 불러왔습니다. 저장 또는 공개 내용 적용을 눌러 주세요.')}catch(e){setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}}
  async function chooseColor(boxColor:string){if(operationLock.current)return;const next={...card,boxColor};setCard(next);if(!next.name||!next.phone)return;operationLock.current=true;setBusy(true);try{setPreview(await (await request('preview?user_id='+encodeURIComponent(selectedOwner),next)).text())}catch(e){setMessage(String(e))}finally{operationLock.current=false;setBusy(false)}}
  const fields: [keyof Card,string,string?][]=[['name','이름'],['department','부서 · 팀'],['title','직책'],['branch','지점 · 본사'],['phone','담당자 휴대전화'],['email','이메일'],['headline','첫 인사 문구'],['specialties','전문 분야 · 강점 태그 (쉼표로 구분)','고객 신뢰, 투자전문, 문제 해결사'],['introduction','소개 문구'],['career','경력 · 약력 (줄바꿈으로 구분)'],['kakaoUrl','카카오톡 상담 링크 (선택)','https://open.kakao.com/… 또는 https://pf.kakao.com/…']];
  return <div className="bc-manager"><header><div><div className="bc-manual-row"><a className="bc-manual-download" href="/manuals/business-card-user-guide.pdf" download="마이옥션_전자명함_사용설명서.pdf"><Download size={17} aria-hidden="true"/>사용설명서 PDF 다운로드</a></div><span className="bc-eyebrow">MY PERSONAL BRAND</span><h1>{isMaster?'전자명함 관리':'나의 전자명함'}</h1><p>첫 통화의 인연이, 다음 상담으로 이어지도록.</p></div><div className="bc-header-tools">
    {isMaster&&<div className="bc-owner-picker"><label htmlFor="bc-owner-search">담당자 검색·선택 <small>마스터 전용</small></label><input id="bc-owner-search" placeholder="이름 · 부서 · 지점 검색" value={ownerSearch} disabled={busy} onChange={e=>setOwnerSearch(e.target.value)}/><select aria-label="관리할 담당자" value={selectedOwner} disabled={busy} onChange={e=>void changeOwner(e.target.value)}>{owners.filter(owner=>owner.id===selectedOwner||`${owner.name} ${owner.department} ${owner.branch} ${owner.position_title}`.toLowerCase().includes(ownerSearch.toLowerCase())).map(owner=><option key={owner.id} value={owner.id}>{owner.name} · {owner.department || owner.branch} {owner.position_title}{owner.role==='resigned'?' (퇴사)':''}</option>)}</select></div>}
    <div className="bc-top-actions"><span className={`bc-status ${published?'is-live':''}`}>{published?'공개 중':'비공개'}</span><button type="button" disabled={busy||!ready} onClick={()=>void showPreview()}>미리보기</button><button type="button" disabled={busy||!ready||editing} onClick={()=>{setEditing(true);setMessage('수정 모드입니다. 변경 후 최종 저장을 눌러 주세요.')}}><Pencil size={16}/>수정</button><button type="button" className="bc-primary" disabled={busy||!ready||!editing} onClick={()=>void save('publish')}><Save size={16}/>최종 저장</button>{isMaster&&<button type="button" className="bc-delete" disabled={busy||!ready||!exists} onClick={()=>void deleteCard()}><Trash2 size={16}/>삭제</button>}</div><small className="bc-note">최종 저장 시 선택한 담당자의 공개 명함에 반영됩니다.</small>
    </div></header>
    <div className="bc-metrics">{[['명함 방문',stats.visits],['추정 방문자',stats.visitors],['추정 재방문',Math.max(0,stats.visits-stats.visitors)],['전화 클릭',stats.phone],['카카오톡 클릭',stats.kakao],['연락처 저장 클릭',stats.saves]].map(([label,value])=><div key={label}><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>)}</div>
    <p className="bc-note">누적 통계 · 기기·브라우저 기준 추정치이며 동일 브라우저의 30분 내 방문은 묶어 집계합니다. 버튼 클릭은 실제 통화·상담·저장 완료를 의미하지 않습니다.</p>
    <p className="bc-message">{message}</p>
    {feedbackVisible&&<div className="bc-feedback" role="status" aria-live="polite">{busy&&<span className="bc-feedback-spinner" aria-hidden="true"/>}<span>{busy?'처리 중입니다. 잠시만 기다려 주세요.':message}</span></div>}
    <div className="bc-columns"><section className="bc-panel bc-editor"><h2>명함 {editing?'편집':'정보'}</h2><p>{editing?'초안 저장 후 미리보기로 확인하고 최종 저장해 주세요.':'우측 상단의 수정 버튼을 누르면 편집할 수 있습니다.'}</p><fieldset disabled={busy||!ready||!editing}>
      <div className="bc-photo-help"><span>백재원 실장 에게 이미지를 주시면 ai 로 깔끔하게 변경해드립니다.</span><a href="https://open.kakao.com/o/s94BCITi" target="_blank" rel="noopener noreferrer">이미지 보정 요청 <ExternalLink size={14}/></a></div>
      <div className="bc-upload">{card.photo?<img src={card.photo} alt="프로필 미리보기"/>:<div className="bc-avatar">사진</div>}<div><strong>사진 지정 · 링크 미리보기</strong>
        <div className="bc-photo-options"><label className="bc-photo-choice">사진첩 · 파일 선택<input type="file" accept="image/*" onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/></label><label className="bc-photo-choice">카메라로 촬영<input type="file" accept="image/*" capture="user" onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/></label></div>
        <small>본인 사진 · JPG·PNG·WebP, 최대 12MB. 권한 요청이 표시되면 사용할 사진 또는 카메라 접근을 허용해 주세요. 앱 내 브라우저에서 열리지 않으면 Safari·Chrome에서 이용해 주세요.</small>{card.photo&&<button type="button" onClick={()=>setCard(c=>({...c,photo:''}))}>사진 제거</button>}</div></div>
      <div className="bc-color-picker"><h3>이름 박스 색상</h3><div className="bc-swatches" role="group" aria-label="명함 박스 색상">{Object.entries(cardColors).map(([key,theme])=><button type="button" key={key} aria-label={theme.label} aria-pressed={card.boxColor===key} onClick={()=>void chooseColor(key)} style={{background:theme.swatch,color:theme.ink}}><span aria-hidden="true">{card.boxColor===key?'✓':''}</span><small>{theme.label}</small></button>)}</div><p className="bc-note">반투명 박스 · 색상에 따라 로고와 글씨가 자동으로 전환됩니다. 변경 내용은 ‘공개 내용 적용’ 후 공개 명함에 반영됩니다.</p></div>
      <p className="bc-note">{isMaster ? '마스터는 휴대전화를 포함한 모든 명함 정보를 수정할 수 있습니다. 사용자 설정 원본은 변경되지 않습니다.' : '이름·부서/팀·직책·지점/본사·휴대전화는 사용자 설정 또는 마스터가 지정한 값으로 표시되며 직접 수정할 수 없습니다.'} 이메일은 가입 이메일을 기본으로 직접 설정할 수 있습니다. 경력·약력은 소개 문구 아래의 별도 영역에 표시됩니다.</p>
      <p className="bc-note">소개·경력·약력의 기본문구는 공통 상담 안내 예시입니다. 실제 경력과 자격 사항은 본인 이력에 맞게 수정해 주세요.</p>
      <button type="button" onClick={()=>{if((card.introduction.trim()||card.career.trim())&&!window.confirm('소개 문구와 경력·약력을 공통 기본문구로 바꿀까요?'))return;setCard(current=>({...current,...defaultCardWriting}))}}>소개·약력 기본문구 채우기</button>
      {fields.map(([key,label,placeholder])=><label className="bc-field" key={key}>{label}{['introduction','career'].includes(key)?<textarea value={card[key]} maxLength={3000} rows={5} onChange={e=>setCard({...card,[key]:e.target.value})}/>:<input readOnly={((fixedCardFields as readonly string[]).includes(key) && !isMaster)} title={((fixedCardFields as readonly string[]).includes(key) && !isMaster)?'사용자 설정 또는 마스터가 지정한 값으로 표시됩니다.':undefined} value={card[key]} maxLength={300} placeholder={placeholder} onChange={e=>setCard({...card,[key]:e.target.value})}/>}</label>)}
      <p className="bc-note">상담 링크가 없으면 카카오톡 버튼에서 담당자 번호 복사와 친구 추가 방법을 안내합니다. 전화번호만으로 개인 채팅창을 바로 열지는 않습니다.</p>
      <section className="bc-optional"><h3>SNS 바로가기 <small>선택</small></h3><p className="bc-note">사용할 항목을 선택한 후 + 버튼을 눌러 주소를 입력하세요. 공개 명함 하단에는 주소 대신 로고만 표시합니다.</p>
        <div className="bc-social-add"><select aria-label="추가할 SNS" value={socialType} onChange={e=>setSocialType(e.target.value as SocialField)}>{Object.entries(socialLabels).map(([key,label])=><option key={key} value={key}>{label}{activeSocial.includes(key as SocialField)?' (추가됨)':''}</option>)}</select><button type="button" aria-label="SNS 링크 추가" disabled={activeSocial.includes(socialType)} onClick={()=>setActiveSocial(current=>current.includes(socialType)?current:[...current,socialType])}>+ 추가</button></div>
        {activeSocial.map(key=><div className="bc-social-row" key={key}><label className="bc-field">{socialLabels[key]} 주소<input type="url" value={card[key]} maxLength={300} placeholder={key==='instagramUrl'?'https://www.instagram.com/계정':key==='blogUrl'?'https://blog.naver.com/계정':'https://www.youtube.com/@채널'} onChange={e=>setCard({...card,[key]:e.target.value})}/></label><button type="button" aria-label={`${socialLabels[key]} 삭제`} onClick={()=>{setActiveSocial(current=>current.filter(item=>item!==key));setCard(current=>({...current,[key]:''}))}}>삭제</button></div>)}
      </section>
      <section className="bc-optional"><label className="bc-video-toggle"><input type="checkbox" checked={videoEnabled} onChange={e=>{setVideoEnabled(e.target.checked);if(!e.target.checked)setCard(current=>({...current,videoUrl:''}))}}/> 유튜브 소개 영상 1편 사용 <small>선택</small></label>
        {videoEnabled&&<label className="bc-field">영상 주소<input type="url" value={card.videoUrl} maxLength={300} placeholder="https://www.youtube.com/watch?v=…" onChange={e=>setCard({...card,videoUrl:e.target.value})}/></label>}
        <p className="bc-note">사진과 YOUR TRUSTED PARTNER 사이에 같은 너비로 표시됩니다. 미사용 또는 주소가 비어 있으면 기존 구성을 유지합니다. 재생 여부는 공개 명함에서 확인해 주세요. 비공개·임베드 제한 영상은 재생되지 않을 수 있습니다.</p>
      </section>
      <section className="bc-optional"><h3>하단 회사소개 · 광고 영역</h3><label className="bc-video-toggle"><input type="checkbox" checked={card.companyHidden==='yes'} onChange={e=>setCard(current=>({...current,companyHidden:e.target.checked?'yes':''}))}/> 사용 안 함</label><p className="bc-note">체크하면 하단 회사소개 전체를 숨깁니다. 업로드한 이미지는 보관되며 다시 사용할 수 있습니다.</p>
        {card.companyHidden!=='yes'&&<><label className="bc-field">커스텀 이미지 첨부 (선택)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void upload(e.target.files?.[0],'companyImage');e.target.value=''}}/></label><p className="bc-note">첨부하면 기본 2페이지 회사소개 대신 이 이미지 한 장을 표시합니다. JPG·PNG·WebP, 최대 12MB. 이미지를 누르면 확대 팝업으로 열립니다.</p>{card.companyImage&&<><img className="bc-company-upload-preview" src={card.companyImage} alt="커스텀 회사소개 미리보기"/><button type="button" onClick={()=>setCard(current=>({...current,companyImage:''}))}>커스텀 이미지 제거 · 기본 회사소개 사용</button></>}</>}
      </section>
      <div className="bc-actions"><button onClick={()=>void save('save')}>초안 저장</button><button onClick={()=>void showPreview()}>미리보기 갱신</button><button className="bc-primary" onClick={()=>void save('publish')}>공개 내용 적용</button>{published&&<button onClick={()=>void save('unpublish')}>비공개 전환</button>}</div>
    </fieldset></section>
    <aside><section className="bc-panel bc-delivery"><h2>고객에게 전달하기</h2><p>링크만 복사하거나 안내 문구와 함께 복사할 수 있습니다.</p>
      {publicUrl?<><input aria-label="공개 명함 주소" readOnly value={publicUrl}/><div className="bc-actions"><button disabled={busy||!ready} onClick={()=>void copyDelivery(publicUrl)}>링크만 복사</button><a href={publicUrl} target="_blank" rel="noreferrer">공개 명함 열기 ↗</a></div></>:<p className="bc-note">명함을 공개하면 전용 주소가 생성됩니다.</p>}
      <label className="bc-field">고객 안내 문구<textarea rows={8} maxLength={3000} disabled={busy||!ready} value={deliveryPreview} onChange={e=>setDeliveryTemplate(editCardMessage(e.target.value,deliveryTemplate,card,deliveryUrl))}/></label>
      <p className="bc-note">담당자 이름·직책·명함 주소가 반영된 내용입니다. 문구를 자유롭게 수정하고 별도로 저장할 수 있습니다.</p>
      <div className="bc-actions"><button disabled={busy||!ready||!deliveryTemplate.trim()} onClick={()=>void saveDelivery()}>안내 문구 저장</button><button disabled={busy||!ready} onClick={()=>setDeliveryTemplate(defaultCardMessage)}>기본문구 복원</button><button className="bc-primary" disabled={busy||!ready||!publicUrl||!deliveryTemplate.trim()} onClick={()=>void copyDelivery(deliveryPreview)}>안내 문구 + 링크 복사</button></div>
      {deliveryTemplate!==savedDelivery.current&&<p className="bc-note">저장하지 않은 문구입니다. 복사는 현재 작성 내용을 사용합니다.</p>}
      {!deliveryTemplate.includes('{전자명함 링크}')&&<p className="bc-note">명함 주소의 자동 반영이 해제되었습니다. <button type="button" disabled={busy||!ready} onClick={()=>setDeliveryTemplate(current=>current+'\n{전자명함 링크}')}>명함 주소 추가</button></p>}
      <label className="bc-field">복사될 내용<textarea readOnly rows={8} value={deliveryPreview}/></label>
      <p className="bc-note">로컬 주소는 외부 고객이 열 수 없습니다. 실제 링크 미리보기는 공개 서버 배포 후 확인할 수 있습니다.</p>
    </section><section className="bc-panel bc-preview"><h2>모바일 미리보기</h2>{preview?<iframe title="전자명함 미리보기" srcDoc={preview} sandbox="allow-scripts"/>:<div className="bc-empty">이름과 연락처를 입력하고<br/>‘미리보기 갱신’을 눌러 주세요.</div>}</section></aside></div>
  </div>;
}
