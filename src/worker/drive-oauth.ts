// Google OAuth 2.0 + Drive API 서버사이드 헬퍼
// - Authorization Code Flow로 refresh_token 획득
// - refresh_token은 AES-GCM으로 암호화하여 D1에 저장
// - access_token은 요청 시마다 refresh_token으로 갱신 (캐싱 없음)

export const GOOGLE_CLIENT_ID =
  '107865264155-g8evoo9chu4pllekoni66fujbl8e1g7t.apps.googleusercontent.com';

export const DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

/** redirect URI 결정 — 요청 host 기반 */
export function resolveRedirectUri(request: Request): string {
  const url = new URL(request.url);
  const host = url.host;
  // 로컬 개발 서버는 localhost:5173 (Vite), 운영은 my-docs.kr
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `http://localhost:5173/oauth/drive/callback`;
  }
  return `https://my-docs.kr/oauth/drive/callback`;
}

/** 암호화 키 파생: GOOGLE_CLIENT_SECRET을 HKDF → AES-GCM 키 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plaintext: string, secret: string): Promise<{ ct: string; iv: string }> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    ct: btoa(String.fromCharCode(...new Uint8Array(ctBuf))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

export async function decryptToken(ct: string, ivB64: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(ptBuf);
}

/** Authorization Code → Token 교환 */
export async function exchangeCodeForTokens(code: string, clientSecret: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json<any>();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data;
}

/** refresh_token으로 새 access_token 획득 */
export async function refreshAccessToken(refreshToken: string, clientSecret: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json<any>();
  if (!res.ok) throw new Error(`token refresh failed: ${JSON.stringify(data)}`);
  return data;
}

/** 현재 토큰으로 사용자 이메일 조회 */
export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json<any>();
  return data.email || null;
}

/** Drive API 래퍼 */
export async function driveApi(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json<any>();
}

/** 폴더 find-or-create */
export async function findOrCreateFolder(token: string, parentId: string, name: string): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and name='${escaped}' and trashed=false`;
  const list = await driveApi(`/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, token);
  if (list.files?.[0]?.id) return list.files[0].id;
  const created = await driveApi('/files?fields=id', token, {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  return created.id;
}

/** 경로 세그먼트 따라 폴더 생성 */
export async function resolveFolderPath(token: string, rootId: string, segments: string[]): Promise<string> {
  let parent = rootId;
  for (const seg of segments) {
    if (!seg) continue;
    parent = await findOrCreateFolder(token, parent, seg);
  }
  return parent;
}

/** PDF Buffer 업로드 (multipart) */
export async function uploadPdfBuffer(
  token: string,
  folderId: string,
  filename: string,
  buffer: ArrayBuffer,
): Promise<{ id: string; size: number }> {
  const metadata = { name: filename, mimeType: 'application/pdf', parents: [folderId] };
  const boundary = 'maBoundary' + Math.random().toString(36).slice(2);
  const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;
  const preBytes = new TextEncoder().encode(preamble);
  const endBytes = new TextEncoder().encode(epilogue);
  const body = new Uint8Array(preBytes.length + buffer.byteLength + endBytes.length);
  body.set(preBytes, 0);
  body.set(new Uint8Array(buffer), preBytes.length);
  body.set(endBytes, preBytes.length + buffer.byteLength);

  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json<any>();
  return { id: data.id, size: Number(data.size) || buffer.byteLength };
}
