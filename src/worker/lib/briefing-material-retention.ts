import { ensureBriefingMaterialSchema } from './briefing-materials';

export type BriefingMaterialRetentionResult = {
  retention_months: number;
  eligible: number;
  archived: number;
  deleted_objects: number;
};

export async function cleanupBackedUpBriefingMaterials(
  env: { DB: D1Database; ARTICLE_BUCKET?: R2Bucket },
  limit = 100,
): Promise<BriefingMaterialRetentionResult> {
  await ensureBriefingMaterialSchema(env.DB);
  const eligible = await env.DB.prepare(`SELECT id, object_key FROM briefing_materials
    WHERE archived_at IS NULL AND created_at < datetime('now', '-3 months')
      AND drive_status = 'success' AND drive_backed_up_at IS NOT NULL
    ORDER BY created_at ASC LIMIT ?`).bind(Math.min(500, Math.max(1, limit))).all<{ id: string; object_key: string }>();
  let archived = 0;
  let deletedObjects = 0;
  for (const row of eligible.results || []) {
    if (row.object_key && env.ARTICLE_BUCKET) {
      await env.ARTICLE_BUCKET.delete(row.object_key);
      deletedObjects += 1;
    }
    const result = await env.DB.prepare(`UPDATE briefing_materials SET archived_at=datetime('now'), object_key='',
      updated_at=datetime('now') WHERE id=? AND archived_at IS NULL AND drive_status='success'`).bind(row.id).run();
    archived += Number(result.meta?.changes || 0);
  }
  return { retention_months: 3, eligible: (eligible.results || []).length, archived, deleted_objects: deletedObjects };
}
