import { socialLabels, safeSocialUrl, escapeCardHtml as e, type BusinessCard, type SocialField } from '../../shared/business-card.ts';
const logos: Record<SocialField,string> = {
  instagramUrl:'<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="card-instagram-gradient" cx="28%" cy="105%" r="125%"><stop offset="0" stop-color="#ffdf00"/><stop offset=".3" stop-color="#ff7a00"/><stop offset=".55" stop-color="#ff004e"/><stop offset=".8" stop-color="#f000cd"/><stop offset="1" stop-color="#9a00ed"/></radialGradient></defs><rect width="32" height="32" rx="8" fill="url(#card-instagram-gradient)"/><rect x="5.5" y="5.5" width="21" height="21" rx="6" fill="none" stroke="white" stroke-width="3"/><circle cx="16" cy="16" r="5.5" fill="none" stroke="white" stroke-width="3"/><circle cx="22.5" cy="9.5" r="1.7" fill="white"/></svg>',
  blogUrl:'<svg viewBox="0 0 32 32" aria-hidden="true"><rect x=".5" y=".5" width="31" height="31" rx="7" fill="white" stroke="#e5e7eb"/><path d="M8 6h16a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4h-5l-3 4-3-4H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="#03c75a"/><text x="16" y="19.7" text-anchor="middle" font-family="Arial,sans-serif" font-size="10.5" font-weight="700" fill="white">blog</text></svg>',
  youtubeUrl:'<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="5" width="30" height="22" rx="7" fill="#f03"/><path d="m13 10 9 6-9 6z" fill="white"/></svg>',
};
export function cardSocialLinks(card: BusinessCard): string {
  const links=(Object.keys(socialLabels) as SocialField[]).map(field=>{
    let url='';try{url=safeSocialUrl(field,card[field] || '')}catch{return ''}
    return url?`<a class="social-link" href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${socialLabels[field]} 바로가기" aria-label="${socialLabels[field]} 바로가기 (새 창)">${logos[field]}</a>`:'';
  }).join('');
  return links?`<nav class="social-links" aria-label="SNS 바로가기">${links}</nav>`:'';
}
