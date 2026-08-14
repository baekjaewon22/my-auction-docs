import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { isHeadOfficeBranch } from '../lib/branchAliases';
import {
  briefingMaterialMonth,
  briefingMaterialObjectKey,
  ensureBriefingMaterialSchema,
  isAllowedBriefingFile,
  MAX_BRIEFING_MATERIAL_BYTES,
  safeBriefingFileName,
  sha256BriefingMaterial,
} from '../lib/briefing-materials';

const briefingMaterials = new Hono<AuthEnv>();
const UPLOAD_ROLES = new Set(['master', 'ceo', 'cc_ref', 'admin']);
const FULL_VIEW_ROLES = new Set(['master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst']);

briefingMaterials.use('*', authMiddleware);

function attachmentDisposition(fileName: string): string {
  const fallback = safeBriefingFileName(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'briefing-material';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function currentProfile(c: any) {
  const auth = c.get('user');
  return await c.env.DB.prepare(`SELECT id, name, role, branch, department, login_type
    FROM users WHERE id = ?`).bind(auth.sub).first();
}

function rejectFreelancer(profile: any) {
  return String(profile?.login_type || '') === 'freelancer';
}

function materialScope(profile: any): { sql: string; values: unknown[] } {
  const role = String(profile?.role || '');
  if (FULL_VIEW_ROLES.has(role) || (role === 'admin' && isHeadOfficeBranch(profile?.branch))) return { sql: '', values: [] };
  if (role === 'director') return { sql: " AND (branch IN ('대전','대전지사','부산','부산지사') OR uploaded_by = ? OR assignee_user_id = ?)", values: [profile.id, profile.id] };
  if (role === 'admin' || role === 'manager') return { sql: ' AND (branch = ? OR uploaded_by = ? OR assignee_user_id = ?)', values: [profile.branch || '', profile.id, profile.id] };
  return { sql: ' AND (uploaded_by = ? OR assignee_user_id = ?)', values: [profile.id, profile.id] };
}

briefingMaterials.get('/upload-options', async (c) => {
  const profile = await currentProfile(c);
  if (!profile || rejectFreelancer(profile) || !UPLOAD_ROLES.has(String(profile.role))) return c.json({ error: '브리핑자료 제출 권한이 없습니다.' }, 403);
  const users = await c.env.DB.prepare(`SELECT id, name, branch FROM users
    WHERE approved = 1 AND role != 'resigned' AND COALESCE(login_type, 'employee') != 'freelancer'
    ORDER BY branch, name`).all<any>();
  return c.json({ current_user_id: profile.id, users: users.results || [] });
});

briefingMaterials.post('/', async (c) => {
  const profile = await currentProfile(c);
  if (!profile || rejectFreelancer(profile) || !UPLOAD_ROLES.has(String(profile.role))) return c.json({ error: '브리핑자료 제출 권한이 없습니다.' }, 403);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: '브리핑자료 저장소가 설정되지 않았습니다.' }, 503);
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > MAX_BRIEFING_MATERIAL_BYTES + 1024 * 1024) return c.json({ error: '브리핑자료는 파일당 최대 50MB입니다.' }, 413);
  if (!(c.req.header('content-type') || '').includes('multipart/form-data')) return c.json({ error: '파일 첨부 형식이 올바르지 않습니다.' }, 415);

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: '첨부 파일이 없습니다.' }, 400);
  const fileName = safeBriefingFileName(file.name || 'briefing-material');
  if (!isAllowedBriefingFile(fileName)) return c.json({ error: 'PDF, PPT, PPTX, PPTM 파일만 첨부할 수 있습니다.' }, 400);
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength) return c.json({ error: '빈 파일은 첨부할 수 없습니다.' }, 400);
  if (buffer.byteLength > MAX_BRIEFING_MATERIAL_BYTES) return c.json({ error: '브리핑자료는 파일당 최대 50MB입니다.' }, 413);

  const assigneeId = String(form.get('assignee_user_id') || profile.id).trim();
  const assignee = await c.env.DB.prepare(`SELECT id, name, branch FROM users
    WHERE id = ? AND approved = 1 AND role != 'resigned'`).bind(assigneeId).first<any>();
  if (!assignee) return c.json({ error: '담당자를 찾을 수 없습니다.' }, 400);
  const caseNumber = String(form.get('case_number') || '').trim().slice(0, 100);
  const month = briefingMaterialMonth();
  const id = crypto.randomUUID();
  const objectKey = briefingMaterialObjectKey(month, id, fileName);
  const sha256 = await sha256BriefingMaterial(buffer);
  await ensureBriefingMaterialSchema(c.env.DB);
  const duplicate = await c.env.DB.prepare(`SELECT id, file_name, created_at FROM briefing_materials
    WHERE sha256 = ? AND uploaded_by = ? AND assignee_user_id = ? AND COALESCE(case_number, '') = ?
      AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(sha256, profile.id, assignee.id, caseNumber).first<any>();
  if (duplicate) return c.json({ error: '이미 제출한 동일한 파일입니다.', duplicate }, 409);

  await c.env.ARTICLE_BUCKET.put(objectKey, buffer, {
    httpMetadata: { contentType: file.type || 'application/octet-stream', contentDisposition: attachmentDisposition(fileName) },
    customMetadata: { uploadedBy: profile.id, assigneeUserId: assignee.id, materialMonth: month, sha256 },
  });
  try {
    await c.env.DB.prepare(`INSERT INTO briefing_materials
      (id, uploaded_by, uploader_name, branch, assignee_user_id, assignee_name, case_number, material_month,
       object_key, file_name, file_type, file_size, sha256, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, profile.id, profile.name || '', assignee.branch || profile.branch || '', assignee.id, assignee.name || '', caseNumber,
        month, objectKey, fileName, file.type || 'application/octet-stream', buffer.byteLength, sha256,
        new Date().toISOString(), new Date().toISOString()).run();
  } catch (error) {
    await c.env.ARTICLE_BUCKET.delete(objectKey).catch(() => undefined);
    throw error;
  }
  return c.json({ success: true, id, file_name: fileName, file_size: buffer.byteLength, drive_status: 'pending' });
});

briefingMaterials.get('/', async (c) => {
  const profile = await currentProfile(c);
  if (!profile || rejectFreelancer(profile)) return c.json({ error: '브리핑자료 열람 권한이 없습니다.' }, 403);
  await ensureBriefingMaterialSchema(c.env.DB);
  const page = Math.max(1, Number(c.req.query('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size') || 20)));
  const month = String(c.req.query('month') || '').trim();
  const branch = String(c.req.query('branch') || '').trim();
  const assignee = String(c.req.query('assignee') || '').trim();
  const search = String(c.req.query('search') || '').trim();
  const scope = materialScope(profile);
  const conditions = ['archived_at IS NULL'];
  const values: unknown[] = [];
  if (month) { conditions.push('material_month = ?'); values.push(month.replace('-', '.')); }
  if (branch) { conditions.push('branch = ?'); values.push(branch); }
  if (assignee) { conditions.push('assignee_name = ?'); values.push(assignee); }
  if (search) { conditions.push('(file_name LIKE ? OR case_number LIKE ? OR assignee_name LIKE ?)'); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const where = `WHERE ${conditions.join(' AND ')}${scope.sql}`;
  const allValues = [...values, ...scope.values];
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM briefing_materials ${where}`).bind(...allValues).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`SELECT id, uploader_name, branch, assignee_user_id, assignee_name, case_number,
      material_month, file_name, file_type, file_size, drive_status, drive_folder_path, drive_backed_up_at, created_at
    FROM briefing_materials ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...allValues, pageSize, (page - 1) * pageSize).all<any>();
  return c.json({ materials: rows.results || [], total: Number(total?.count || 0), page, page_size: pageSize });
});

briefingMaterials.get('/:id/download', async (c) => {
  const profile = await currentProfile(c);
  if (!profile || rejectFreelancer(profile)) return c.json({ error: '브리핑자료 열람 권한이 없습니다.' }, 403);
  await ensureBriefingMaterialSchema(c.env.DB);
  const scope = materialScope(profile);
  const row = await c.env.DB.prepare(`SELECT * FROM briefing_materials WHERE id = ? AND archived_at IS NULL${scope.sql}`)
    .bind(c.req.param('id'), ...scope.values).first<any>();
  if (!row) return c.json({ error: '브리핑자료를 찾을 수 없습니다.' }, 404);
  if (!row.object_key) return c.json({ error: '원본은 Google Drive 장기보관으로 이동했습니다.' }, 410);
  const object = await c.env.ARTICLE_BUCKET.get(row.object_key);
  if (!object) return c.json({ error: '원본 파일을 찾을 수 없습니다.' }, 404);
  return new Response(object.body, { headers: {
    'Content-Type': row.file_type || object.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(object.size), 'Content-Disposition': attachmentDisposition(row.file_name),
    'Cache-Control': 'private, max-age=300',
  } });
});

export default briefingMaterials;
