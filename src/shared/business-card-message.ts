export const defaultCardMessage = `안녕하세요. 방금 통화드린 마이옥션 {이름 직책}입니다.
경매 상담과 관련해 제 소개와 주요 상담 분야를 보내드립니다.
아래에서 연락처를 저장하실 수 있으며, 궁금한 물건의 사건번호를 이 문자로 보내주셔도 됩니다.
[프로필 링크 / 전자명함]
{전자명함 링크}`;

export function normalizeCardMessage(value: unknown): string {
  if(typeof value!=='string' || !value.trim() || value.length>3000) throw new Error('안내 문구는 1~3,000자로 입력해 주세요.');
  return value.trim();
}

export function renderCardMessage(template: string, card: {name:string;title:string}, url: string): string {
  return template.split('[{전자명함 링크}]').join('{전자명함 링크}').replace(/\{이름 직책\}|\{이름\}|\{직책\}|\{전자명함 링크\}/g, token=>({
    '{이름 직책}':[card.name,card.title].filter(Boolean).join(' '),
    '{이름}':card.name, '{직책}':card.title, '{전자명함 링크}':url,
  })[token]!);
}

// Keep automatic fields internally while the editor shows only resolved text.
export function editCardMessage(text: string, previous: string, card: {name:string;title:string}, url: string): string {
  const tokens=['{이름 직책}','{이름}','{직책}','{전자명함 링크}'];
  const values=tokens.filter(token=>previous.includes(token)).map(token=>({token,value:renderCardMessage(token,card,url)})).filter(item=>item.value).sort((a,b)=>b.value.length-a.value.length);
  if(!values.length) return text;
  const pattern=new RegExp(values.map(item=>item.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
  return text.replace(pattern,value=>values.find(item=>item.value===value)!.token);
}
