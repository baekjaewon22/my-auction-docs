const PLANNER_DRAFT_PREFIX = 'myauction:planner-draft:v1:';

export type StoredPlannerDraft = {
  snapshots: unknown[];
  workspace: Record<string, unknown>;
  updatedAt: string;
};

export function plannerDraftKey(userId: string) {
  return `${PLANNER_DRAFT_PREFIX}${String(userId || 'anonymous')}`;
}

export function loadPlannerDraft(userId: string): StoredPlannerDraft | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(plannerDraftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      workspace: parsed.workspace && typeof parsed.workspace === 'object' ? parsed.workspace : {},
      updatedAt: String(parsed.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

export function savePlannerDraft(userId: string, value: Omit<StoredPlannerDraft, 'updatedAt'>) {
  if (!userId) return;
  try {
    localStorage.setItem(plannerDraftKey(userId), JSON.stringify({
      ...value,
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // Large screenshots can exceed the browser quota. Keep calculation values even then.
    try {
      const snapshots = (value.snapshots || []).map((item: any) => ({
        ...item,
        image_data_url: undefined,
        message: removeEmbeddedImages(item?.message),
      }));
      localStorage.setItem(plannerDraftKey(userId), JSON.stringify({
        snapshots,
        workspace: removeEmbeddedImages(value.workspace),
        updatedAt: new Date().toISOString(),
      }));
    } catch { /* storage unavailable */ }
  }
}

function removeEmbeddedImages(value: unknown): any {
  if (Array.isArray(value)) return value.map(removeEmbeddedImages);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && value.startsWith('data:image/') ? undefined : value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/image|screenshot|capture|thumbnail/i.test(key) && typeof item === 'string' && item.startsWith('data:image/')) continue;
    result[key] = removeEmbeddedImages(item);
  }
  return result;
}

export function clearPlannerDraft(userId: string) {
  if (!userId) return;
  try {
    window.dispatchEvent(new Event('myauction:planner-clear'));
    localStorage.removeItem(plannerDraftKey(userId));
  } catch { /* */ }
}

export function clearAllPlannerDrafts() {
  try {
    window.dispatchEvent(new Event('myauction:planner-clear'));
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(PLANNER_DRAFT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* */ }
}
