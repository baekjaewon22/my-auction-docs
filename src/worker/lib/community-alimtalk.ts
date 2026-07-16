import { APP_URL, sendAlimtalkByTemplate } from '../alimtalk';
import type { AlimtalkTemplateKey } from '../alimtalk';

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
  if (category === 'community' || category === 'eviction_quote' || category === 'legal_support') {
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
