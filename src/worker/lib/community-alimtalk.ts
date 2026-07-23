import { APP_URL, sendAlimtalkByTemplate } from '../alimtalk';
import type { AlimtalkTemplateKey } from '../alimtalk';
import { communityCreatedNotificationMode } from '../../shared/community-notifications';

type CommunityCategory = 'eviction_quote' | 'legal_support';

type CommunityNote = {
  id: string;
  title: string;
  category: string | null;
  visibility?: string | null;
  legal_subcategory?: string | null;
  court?: string | null;
  case_number?: string | null;
  author_id?: string | null;
  author_name: string;
  is_anonymous?: number | boolean | null;
  created_at?: string | null;
};

type CommunityComment = {
  id: string;
  authorId: string;
  authorName: string;
  isAnonymous?: boolean;
};

type SendOptions = {
  force?: boolean;
};

type SendResult = {
  sent: boolean;
  templateKey?: AlimtalkTemplateKey;
  phones: number;
  reason?: string;
};

type CommunityRecipient = { id: string; phone: string };

const RECIPIENT_CATEGORIES: Record<CommunityCategory, string> = {
  eviction_quote: 'community_eviction_quote',
  legal_support: 'community_legal_support',
};

async function configuredRecipients(
  db: D1Database,
  category: string,
  fallback: () => Promise<CommunityRecipient[]>,
): Promise<CommunityRecipient[]> {
  try {
    const rows = await db.prepare(`
      SELECT DISTINCT u.id, u.phone
      FROM alimtalk_recipients r
      JOIN users u ON u.id = r.user_id
      WHERE r.category = ? AND r.is_active = 1 AND u.approved = 1
        AND u.phone IS NOT NULL AND u.phone != ''
    `).bind(category).all<CommunityRecipient>();
    if ((rows.results || []).length > 0) return rows.results;
  } catch {
    // 이전 스키마에서는 운영 수신자 설정 테이블이 없을 수 있으므로 조직 기준으로 대체한다.
  }
  return fallback();
}

async function evictionQuoteRecipients(db: D1Database): Promise<CommunityRecipient[]> {
  return configuredRecipients(db, RECIPIENT_CATEGORIES.eviction_quote, async () => {
    const rows = await db.prepare(`
      SELECT DISTINCT u.id, u.phone
      FROM users u LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approved = 1 AND u.phone IS NOT NULL AND u.phone != ''
        AND (
          u.department = '명도팀' OR t.name = '명도팀'
          OR (REPLACE(u.branch, ' ', '') IN ('의정부', '의정부본사') AND u.position_title = '지사장')
        )
    `).bind().all<CommunityRecipient>();
    return rows.results || [];
  });
}

async function legalSupportRecipients(db: D1Database): Promise<CommunityRecipient[]> {
  return configuredRecipients(db, RECIPIENT_CATEGORIES.legal_support, async () => {
    const rows = await db.prepare(`
      SELECT DISTINCT u.id, u.phone
      FROM users u LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approved = 1 AND u.phone IS NOT NULL AND u.phone != ''
        AND (u.department = '법률지원팀' OR t.name = '법률지원팀')
    `).bind().all<CommunityRecipient>();
    return rows.results || [];
  });
}

export async function communityBroadcastRecipientIds(db: D1Database, category: string): Promise<string[]> {
  const configuredCategory = RECIPIENT_CATEGORIES[category as CommunityCategory];
  if (!configuredCategory) return [];
  try {
    const configured = await db.prepare(`
      SELECT DISTINCT u.id
      FROM alimtalk_recipients r JOIN users u ON u.id = r.user_id
      WHERE r.category = ? AND r.is_active = 1 AND u.approved = 1
    `).bind(configuredCategory).all<{ id: string }>();
    if ((configured.results || []).length > 0) return configured.results.map((row) => row.id);
  } catch {
    // 이전 스키마는 아래 조직 기준으로 대체한다.
  }
  if (category === 'eviction_quote') {
    const rows = await db.prepare(`
      SELECT DISTINCT u.id FROM users u LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approved = 1 AND (
        u.department = '명도팀' OR t.name = '명도팀'
        OR (REPLACE(u.branch, ' ', '') IN ('의정부', '의정부본사') AND u.position_title = '지사장')
      )
    `).bind().all<{ id: string }>();
    return (rows.results || []).map((row) => row.id);
  }
  if (category === 'legal_support') {
    const rows = await db.prepare(`
      SELECT DISTINCT u.id FROM users u LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.approved = 1 AND (u.department = '법률지원팀' OR t.name = '법률지원팀')
    `).bind().all<{ id: string }>();
    return (rows.results || []).map((row) => row.id);
  }
  return [];
}

function noteDate(note: CommunityNote): string {
  return String(note.created_at || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString()).slice(0, 10);
}

async function directShareRecipient(db: D1Database, visibility?: string | null): Promise<{ name: string; phone: string } | null> {
  const targetUserId = String(visibility || '').startsWith('user:') ? String(visibility).slice(5) : '';
  if (!targetUserId) return null;
  const row = await db.prepare(`
    SELECT name, phone
    FROM users
    WHERE id = ?
      AND approved = 1
      AND phone IS NOT NULL
      AND phone != ''
    LIMIT 1
  `).bind(targetUserId).first<{ name: string; phone: string }>();
  return row || null;
}

export async function sendCommunityNoteCreatedAlimtalk(
  env: Record<string, unknown>,
  db: D1Database,
  note: CommunityNote,
  options: SendOptions = {},
): Promise<SendResult> {
  const category = note.category || 'community';
  const notificationMode = communityCreatedNotificationMode({
    category,
    visibility: note.visibility,
    legalSubcategory: note.legal_subcategory,
  });
  if (notificationMode === 'direct') {
    const recipient = await directShareRecipient(db, note.visibility);
    if (!recipient) return { sent: false, phones: 0, reason: 'not a direct share or missing recipient phone' };
    if (String(note.visibility).slice(5) === note.author_id) return { sent: false, phones: 0, reason: 'direct share target is author' };
    const result = await sendAlimtalkByTemplate(
      env,
      'COMMUNITY_DIRECT_SHARE',
      {
        author_name: note.is_anonymous ? '익명' : note.author_name,
        title: note.title,
        date: noteDate(note),
        link: `${APP_URL}/admin-notes`,
      },
      [recipient.phone],
      { db, relatedType: 'admin_note_direct_share', relatedId: note.id, force: options.force },
    );
    return { sent: !!result, templateKey: 'COMMUNITY_DIRECT_SHARE', phones: 1 };
  }

  if (notificationMode === 'broadcast' && category === 'eviction_quote') {
    const recipients = (await evictionQuoteRecipients(db)).filter((row) => row.id !== note.author_id);
    if (recipients.length === 0) return { sent: false, phones: 0, reason: 'no eviction quote recipients' };
    const result = await sendAlimtalkByTemplate(
      env,
      'COMMUNITY_EVICTION_QUOTE',
      {
        author_name: note.is_anonymous ? '익명' : note.author_name,
        court: String(note.court || '-'),
        case_number: String(note.case_number || '-'),
        title: note.title,
        link: `${APP_URL}/admin-notes`,
      },
      recipients.map((row) => row.phone),
      { db, relatedType: 'admin_note', relatedId: note.id, force: options.force },
    );
    return { sent: !!result, templateKey: 'COMMUNITY_EVICTION_QUOTE', phones: recipients.length };
  }

  if (notificationMode === 'broadcast' && category === 'legal_support') {
    const recipients = (await legalSupportRecipients(db)).filter((row) => row.id !== note.author_id);
    if (recipients.length === 0) return { sent: false, phones: 0, reason: 'no legal support recipients' };
    const result = await sendAlimtalkByTemplate(
      env,
      'COMMUNITY_LEGAL_SUPPORT',
      {
        author_name: note.is_anonymous ? '익명' : note.author_name,
        title: note.title,
        date: noteDate(note),
        link: `${APP_URL}/admin-notes`,
      },
      recipients.map((row) => row.phone),
      { db, relatedType: 'admin_note', relatedId: note.id, force: options.force },
    );
    return { sent: !!result, templateKey: 'COMMUNITY_LEGAL_SUPPORT', phones: recipients.length };
  }

  return { sent: false, phones: 0, reason: 'not a community notification category' };
}

export async function sendCommunityCommentAlimtalk(
  env: Record<string, unknown>,
  db: D1Database,
  note: CommunityNote & { receiver_name?: string | null; receiver_phone?: string | null },
  comment: CommunityComment,
  options: SendOptions = {},
): Promise<SendResult> {
  if (!note.receiver_phone) return { sent: false, phones: 0, reason: 'missing receiver phone' };
  if (note.author_id === comment.authorId) return { sent: false, phones: 0, reason: 'comment author is note author' };

  const category = note.category || 'community';
  if (category === 'eviction_quote') {
    const result = await sendAlimtalkByTemplate(
      env,
      'COMMUNITY_EVICTION_QUOTE_ANSWERED',
      {
        receiver_name: note.receiver_name || '담당자',
        court: note.court || '-',
        case_number: note.case_number || '-',
        responder_name: comment.isAnonymous ? '익명' : comment.authorName,
        link: `${APP_URL}/admin-notes`,
      },
      [note.receiver_phone],
      { db, relatedType: 'admin_note_comment', relatedId: comment.id, force: options.force },
    );
    return { sent: !!result, templateKey: 'COMMUNITY_EVICTION_QUOTE_ANSWERED', phones: 1 };
  }

  if (category === 'legal_support' && !['legal_terms', 'law_reference'].includes(note.legal_subcategory || 'lawsuit')) {
    const result = await sendAlimtalkByTemplate(
      env,
      'COMMUNITY_LEGAL_SUPPORT_ANSWERED',
      {
        receiver_name: note.receiver_name || '담당자',
        title: note.title,
        responder_name: comment.isAnonymous ? '익명' : comment.authorName,
        link: `${APP_URL}/admin-notes`,
      },
      [note.receiver_phone],
      { db, relatedType: 'admin_note_comment', relatedId: comment.id, force: options.force },
    );
    return { sent: !!result, templateKey: 'COMMUNITY_LEGAL_SUPPORT_ANSWERED', phones: 1 };
  }

  return { sent: false, phones: 0, reason: 'not a community answer notification category' };
}

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      first<T = unknown>(): Promise<T | null>;
    };
    run(): Promise<unknown>;
  };
}
