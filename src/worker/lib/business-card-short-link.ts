const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
export function cardLinkWithoutClosingBracket(value: string): string | null {
  const candidate=value.replace(/\]+$/,'');
  return candidate!==value && /^(?:[abcdefghjkmnpqrstuvwxyz23456789]{8}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(candidate)?candidate:null;
}
export function newCardCode(): string {
  // Rejection sampling avoids bias; confusing characters are omitted.
  let code='';
  while(code.length<8){
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    for(const byte of bytes){if(byte<256-(256%alphabet.length))code+=alphabet[byte%alphabet.length];if(code.length===8)break;}
  }
  return code;
}
export async function ensureCardShortLink(db: D1Database, slug: string): Promise<string> {
  for(let attempt=0;attempt<8;attempt++){
    const existing=await db.prepare('SELECT code FROM business_card_short_links WHERE card_slug=?').bind(slug).first<{code:string}>();
    if(existing)return existing.code;
    const code=newCardCode();
    await db.prepare('INSERT OR IGNORE INTO business_card_short_links(code,card_slug) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM business_cards WHERE slug=?)').bind(code,slug,code).run();
    const saved=await db.prepare('SELECT code FROM business_card_short_links WHERE card_slug=?').bind(slug).first<{code:string}>();
    if(saved)return saved.code;
  }
  throw new Error('짧은 명함 주소 생성에 실패했습니다. 다시 시도해 주세요.');
}
export const publishedCardSql = `SELECT bc.* FROM business_cards bc JOIN users u ON u.id=bc.user_id WHERE (bc.slug=? OR bc.slug=(SELECT card_slug FROM business_card_short_links WHERE code=?)) AND bc.published IS NOT NULL AND u.approved=1 AND u.role!='resigned'`;
