// Google Drive 백업 유틸 — Google Identity Services (GIS) 토큰 플로우
// 클라이언트 ID는 공개해도 안전한 값 (OAuth 2.0 web app public identifier)

export const GOOGLE_CLIENT_ID =
  '107865264155-g8evoo9chu4pllekoni66fujbl8e1g7t.apps.googleusercontent.com';
// drive (전체 접근) — 사용자가 미리 만든 폴더에도 업로드 가능
// + openid/email/profile — 연결 계정 이메일 표시용
export const DRIVE_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive';
// Drive API 호출 시 실제로 필요한 핵심 scope (granted 여부 검증용)
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive';

declare global {
  interface Window {
    google?: any;
  }
}

let gisLoaded = false;
let currentToken: { access_token: string; expires_at: number; email?: string } | null = null;

// GIS 스크립트 동적 로드
export async function loadGIS(): Promise<void> {
  if (gisLoaded && window.google?.accounts?.oauth2) return;
  if (document.querySelector('script[data-gis]')) {
    // 이미 로딩중 — 준비될 때까지 대기
    await new Promise<void>(resolve => {
      const check = () => (window.google?.accounts?.oauth2 ? resolve() : setTimeout(check, 50));
      check();
    });
    gisLoaded = true;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.setAttribute('data-gis', '1');
    s.onload = () => { gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('GIS 스크립트 로드 실패'));
    document.head.appendChild(s);
  });
}

// 토큰 요청 (팝업)
export async function requestToken(forceConsent = false): Promise<string> {
  await loadGIS();
  // 캐시된 토큰이 만료 전이면 재사용
  if (!forceConsent && currentToken && Date.now() < currentToken.expires_at - 30_000) {
    return currentToken.access_token;
  }
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      prompt: forceConsent ? 'consent' : '',
      callback: (resp: any) => {
        console.log('[GIS] token response', resp);
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if (!resp.access_token) { reject(new Error('access_token을 받지 못했습니다.')); return; }
        // drive.file scope가 실제로 grant 되었는지 확인
        const granted = (resp.scope || '').split(' ');
        if (!granted.includes(REQUIRED_SCOPE)) {
          reject(new Error(
            'Drive 권한이 부여되지 않았습니다. Google 동의 화면에서 "Google Drive 파일에 대한 액세스" 체크박스를 반드시 켜주세요.\n\n현재 받은 권한: ' + (resp.scope || '없음')
          ));
          return;
        }
        currentToken = {
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
        };
        resolve(resp.access_token);
      },
      error_callback: (err: any) => {
        console.error('[GIS] error_callback', err);
        const type = err?.type || err?.error || 'oauth_error';
        const detail = err?.message || err?.error_description || '';
        const msg = type === 'popup_closed'
          ? '팝업이 닫혔습니다. 다시 시도해주세요.'
          : type === 'popup_failed_to_open'
          ? '팝업이 차단되었습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 시도하세요.'
          : `OAuth 오류: ${type} ${detail}`;
        reject(new Error(msg));
      },
    });
    client.requestAccessToken();
  });
}

export function getTokenInfo() {
  if (!currentToken) return null;
  if (Date.now() >= currentToken.expires_at) return null;
  return { email: currentToken.email, expires_at: currentToken.expires_at };
}

export function clearToken() {
  if (currentToken?.access_token && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(currentToken.access_token); } catch { /* ignore */ }
  }
  currentToken = null;
}

// 현재 토큰으로 사용자 이메일 조회 (UserInfo 엔드포인트)
export async function fetchCurrentEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (currentToken) currentToken.email = data.email;
    return data.email || null;
  } catch { return null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Drive API 래퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function driveFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[Drive API ${res.status}]`, path, text);
    let detail = text;
    try { const parsed = JSON.parse(text); detail = parsed?.error?.message || text; } catch { /* ignore */ }
    throw new Error(`Drive API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// 루트 폴더 ID 유효성 사전 검증 — 404/403 원인 분리
export async function verifyFolder(token: string, folderId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const id = extractFolderId(folderId);
    if (!id || id.includes('/') || id.includes('?') || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return { ok: false, error: `잘못된 폴더 ID 형식입니다: "${folderId}". Drive 폴더 URL 또는 영숫자로 된 ID만 붙여넣으세요.` };
    }
    const data = await driveFetch(`/files/${id}?fields=id,name,mimeType,trashed`, token);
    if (data.trashed) return { ok: false, error: '폴더가 휴지통에 있습니다.' };
    if (data.mimeType !== 'application/vnd.google-apps.folder') return { ok: false, error: '폴더가 아닌 파일 ID입니다. 폴더 URL에서 ID를 복사했는지 확인하세요.' };
    return { ok: true, name: data.name };
  } catch (err: any) {
    const msg = String(err.message || err);
    if (msg.includes('404')) return { ok: false, error: '해당 ID의 폴더를 찾을 수 없습니다. 연결된 Google 계정 소유가 아니거나 삭제된 폴더입니다.' };
    if (msg.includes('403')) return { ok: false, error: '폴더 접근 권한이 없습니다.' };
    return { ok: false, error: msg };
  }
}

// Drive 폴더 URL에서 ID 자동 추출
export function extractFolderId(input: string): string {
  const trimmed = input.trim();
  // drive.google.com/drive/folders/ID[?...]
  const m = trimmed.match(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  // 이미 ID 형태면 그대로
  return trimmed;
}

// 폴더 검색 (특정 부모 아래)
export async function findFolder(token: string, parentId: string, name: string): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and name='${escaped}' and trashed=false`;
  const data = await driveFetch(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`, token);
  return data.files?.[0]?.id || null;
}

export async function createFolder(token: string, parentId: string, name: string): Promise<string> {
  const data = await driveFetch('/files?fields=id', token, {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  return data.id;
}

// 경로 세그먼트 순회 find-or-create (간단한 in-memory 캐시 포함)
const folderCache = new Map<string, string>();
export async function resolvePath(token: string, rootId: string, segments: string[]): Promise<string> {
  let parent = extractFolderId(rootId);
  let cacheKey = parent;
  for (const seg of segments) {
    if (!seg) continue;
    cacheKey += `/${seg}`;
    const cached = folderCache.get(cacheKey);
    if (cached) { parent = cached; continue; }
    const found = await findFolder(token, parent, seg);
    parent = found || (await createFolder(token, parent, seg));
    folderCache.set(cacheKey, parent);
  }
  return parent;
}

// PDF Blob 업로드 (multipart)
export async function uploadPdf(token: string, folderId: string, filename: string, blob: Blob): Promise<{ id: string; size: number }> {
  const metadata = { name: filename, mimeType: 'application/pdf', parents: [folderId] };
  const boundary = '---maBackup' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return { id: data.id, size: Number(data.size) || blob.size };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 경로·파일명 패턴 치환
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type DocMeta = {
  id: string;
  title: string;
  author_name?: string;
  author_branch?: string;
  author_department?: string;
  author_position?: string;    // 직책 (실장, 차장, 대리 등)
  branch?: string;
  department?: string;
  approved_at?: string;        // ISO
  created_at?: string;
  template_name?: string;      // 문서 유형
  client_name?: string;
};

export function applyPattern(pattern: string, meta: DocMeta): string {
  const dateStr = meta.approved_at || meta.created_at || new Date().toISOString();
  const d = new Date(dateStr);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const vars: Record<string, string> = {
    'yyyy': yyyy,
    'yyyy-mm': `${yyyy}-${mm}`,
    'yyyy-mm-dd': `${yyyy}-${mm}-${dd}`,
    'yyyy.mm.dd': `${yyyy}.${mm}.${dd}`,           // 한국식 점 구분
    'yyyy.mm': `${yyyy}.${mm}`,
    'branch': meta.author_branch || meta.branch || '미지정',
    'department': meta.author_department || meta.department || '',
    'doc_type': meta.template_name || '문서',
    'author': meta.author_name || '',
    'position': meta.author_position || '',         // 직책
    'title': meta.title || '',
    'client_name': meta.client_name || meta.title || '',
    'status': 'approved',
  };
  return pattern.replace(/\{([^}]+)\}/g, (_, key) => vars[key.trim()] ?? '')
    .replace(/\s+/g, ' ').trim();  // 빈 변수 치환 후 연속 공백 정리
}

export function sanitizeName(name: string): string {
  // Drive는 대부분의 문자 허용하나 파일/폴더 이름에 슬래시는 경로 구분자라 제외
  return name.replace(/[\/\\]+/g, '_').replace(/\s+/g, ' ').trim();
}

export function buildFolderPath(pattern: string, meta: DocMeta): string[] {
  const raw = applyPattern(pattern, meta);
  return raw.split('/').map(s => sanitizeName(s)).filter(Boolean);
}

export function buildFilename(pattern: string, meta: DocMeta): string {
  const raw = applyPattern(pattern, meta);
  const safe = sanitizeName(raw).slice(0, 120);
  return safe.endsWith('.pdf') ? safe : `${safe}.pdf`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 문서 PDF Blob 생성 (html2pdf 이용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateDocumentPdfBlob(
  docId: string,
  api: typeof import('../api').api,
): Promise<{ blob: Blob; title: string; meta: DocMeta }> {
  const [docRes, sigRes, stepsRes] = await Promise.all([
    api.documents.get(docId),
    api.signatures.getByDocument(docId),
    api.documents.steps(docId),
  ]);
  const doc = docRes.document as any;
  const signatures = sigRes.signatures || [];
  const approvalSteps = stepsRes.steps || [];
  const title = doc.title || '문서';
  const htmlContent: string = doc.content || '';
  const isPropertyReport =
    htmlContent.includes('property-report') || htmlContent.includes('물건분석 보고서');

  // html2pdf 동적 로드
  const html2pdf = (await import('html2pdf.js' as any)).default;

  // PDF 렌더 컨테이너 — A4 content width(180mm ≈ 680px)에 맞춰 설정
  // 모달이 z-index 1000으로 덮고 있으므로 사용자에겐 보이지 않음
  const pdfContainer = document.createElement('div');
  pdfContainer.style.width = '680px'; // A4 - 15mm margins
  pdfContainer.style.minHeight = '200px';
  pdfContainer.style.background = '#ffffff';
  pdfContainer.style.padding = '0';
  pdfContainer.style.color = '#000';
  pdfContainer.style.boxSizing = 'border-box';
  pdfContainer.style.overflow = 'hidden';

  if (isPropertyReport) {
    pdfContainer.style.fontFamily = '"맑은 고딕", "Malgun Gothic", sans-serif';
    pdfContainer.style.color = '#1a1a1a';
    pdfContainer.innerHTML = htmlContent;
  } else {
    pdfContainer.style.fontFamily = '"Segoe UI", sans-serif';
    pdfContainer.style.color = '#202124';

    // 결재란
    const sigHeader = document.createElement('div');
    sigHeader.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:20px;padding-right:4px;';
    const sigTable = document.createElement('table');
    sigTable.style.cssText = 'border-collapse:collapse;font-size:9px;';

    const slots: { label: string; sig?: any }[] = [
      { label: '작성자', sig: signatures[0] },
    ];
    for (const step of approvalSteps) {
      const stepSig = signatures.find(
        (s: any) => s.user_id === step.approver_id && signatures.indexOf(s) >= 1,
      );
      slots.push({ label: step.approver_name || `승인 ${step.step_order}`, sig: stepSig });
    }
    if (approvalSteps.length === 0) slots.push({ label: '승인자', sig: signatures[1] });

    const headerRow = document.createElement('tr');
    slots.forEach(s => {
      const th = document.createElement('th');
      th.style.cssText =
        'border:1px solid #999;padding:3px 8px;background:#f5f5f5;font-size:9px;width:60px;text-align:center;';
      th.textContent = s.label;
      headerRow.appendChild(th);
    });
    sigTable.appendChild(headerRow);

    const dataRow = document.createElement('tr');
    slots.forEach(s => {
      const td = document.createElement('td');
      td.style.cssText =
        'border:1px solid #999;padding:3px;height:45px;width:60px;text-align:center;vertical-align:middle;';
      if (s.sig) {
        const img = document.createElement('img');
        img.src = s.sig.signature_data;
        img.style.cssText = 'width:55px;height:28px;object-fit:contain;';
        td.appendChild(img);
        const name = document.createElement('div');
        name.style.cssText = 'font-size:8px;color:#666;margin-top:2px;';
        name.textContent = s.sig.user_name || '';
        td.appendChild(name);
      }
      dataRow.appendChild(td);
    });
    sigTable.appendChild(dataRow);
    sigHeader.appendChild(sigTable);
    pdfContainer.appendChild(sigHeader);

    const titleEl = document.createElement('h2');
    titleEl.style.cssText = 'text-align:center;margin-bottom:16px;font-size:18px;';
    titleEl.textContent = title;
    pdfContainer.appendChild(titleEl);

    const content = document.createElement('div');
    content.innerHTML = htmlContent;
    content.style.cssText = 'font-size:12px;line-height:1.6;';
    pdfContainer.appendChild(content);
  }

  document.body.appendChild(pdfContainer);
  // 브라우저가 레이아웃을 완료하고 이미지 로딩이 끝나길 한 틱 대기
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  // signature 이미지 로딩 대기
  const imgs = pdfContainer.querySelectorAll('img');
  await Promise.all(Array.from(imgs).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      img.onload = () => resolve(); img.onerror = () => resolve();
    });
  }));

  try {
    const blob: Blob = await (html2pdf().set as any)({
      margin: isPropertyReport ? [0, 0, 0, 0] : [15, 15, 15, 15],
      filename: `${title}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: 680,
        windowWidth: 680,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(pdfContainer).outputPdf('blob');

    const meta: DocMeta = {
      id: doc.id,
      title,
      author_name: doc.author_name,
      author_branch: doc.author_branch || doc.branch,
      author_department: doc.author_department || doc.department,
      branch: doc.branch,
      department: doc.department,
      approved_at: doc.updated_at,
      created_at: doc.created_at,
      template_name: isPropertyReport ? '물건분석보고서' : '컨설팅계약서',
      client_name: (doc.title || '').split(' ')[0] || doc.title,
    };
    return { blob, title, meta };
  } finally {
    pdfContainer.remove();
  }
}
