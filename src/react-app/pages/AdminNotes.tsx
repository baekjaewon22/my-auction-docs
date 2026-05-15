import { useEffect, useState, type ClipboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import { useDepartments } from '../hooks/useDepartments';
import { StickyNote, Plus, X, Trash2, ArrowLeft, Pin, MessageSquare, Send, Edit3, BookOpen, EyeOff, Search, Gavel, Scale, Paperclip, Download, Printer, Handshake } from 'lucide-react';
import Cooperation from './Cooperation';

type NoteCategory = 'community' | 'eviction_quote' | 'legal_support' | 'cooperation';
type LegalSubcategory = 'consultation' | 'law_reference';

interface Note {
  id: string;
  title: string;
  content: string;
  author_id: string;
  author_name: string;
  author_position?: string;
  display_name?: string;
  is_anonymous: number;
  visibility: string;
  pinned: number;
  source_type?: string;
  created_at: string;
  updated_at: string;
  comment_count: number;
  attachment_count?: number;
  category?: NoteCategory;
  legal_subcategory?: LegalSubcategory;
  court?: string;
  case_number?: string;
}

interface Comment {
  id: string;
  note_id: string;
  author_id: string;
  author_name: string;
  author_position?: string;
  display_name?: string;
  is_anonymous: number;
  content: string;
  created_at: string;
}

interface NoteAttachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_data: string;
}

const CATEGORIES: Array<{ key: NoteCategory; label: string; icon: typeof StickyNote }> = [
  { key: 'community', label: '커뮤니티', icon: StickyNote },
  { key: 'eviction_quote', label: '명도견적의뢰', icon: Gavel },
  { key: 'legal_support', label: '법률지원', icon: Scale },
  { key: 'cooperation', label: '업무협조요청', icon: Handshake },
];

const LEGAL_SUBCATEGORIES: Array<{ key: LegalSubcategory; label: string }> = [
  { key: 'consultation', label: '문의 상담' },
  { key: 'law_reference', label: '관련법령' },
];

const COURTS = ['서울중앙지방법원', '서울동부지방법원', '서울서부지방법원', '서울남부지방법원', '서울북부지방법원', '의정부지방법원', '인천지방법원', '수원지방법원', '대전지방법원', '대구지방법원', '부산지방법원', '광주지방법원', '울산지방법원', '창원지방법원', '청주지방법원', '춘천지방법원', '전주지방법원', '제주지방법원'];

function authorLabel(item: { display_name?: string; author_name?: string; author_position?: string; is_anonymous?: number }) {
  if (item.display_name) return item.display_name;
  if (item.author_position) return `${item.author_name} / ${item.author_position}`;
  return item.author_name || '익명';
}

function parseKstDate(iso: string) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return new Date(iso);
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh) - 9, Number(mm), Number(ss)));
}

function formatDate(iso: string) {
  const d = parseKstDate(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getVisibilityLabel(v: string): string {
  if (v === 'all') return '전체';
  if (v === 'branch') return '지사';
  if (v === 'department') return '팀';
  if (v.startsWith('team:')) return v.replace('team:', '');
  return '전체';
}

function getLegalSubcategoryLabel(value?: string): string {
  return LEGAL_SUBCATEGORIES.find(item => item.key === value)?.label || '문의 상담';
}

function isLegalConsultation(note: { category?: NoteCategory; legal_subcategory?: string }) {
  return note.category === 'legal_support' && (note.legal_subcategory || 'consultation') === 'consultation';
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function AdminNotes() {
  const { user } = useAuthStore();
  const { departments } = useDepartments();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeLegalSubcategory, setActiveLegalSubcategory] = useState<LegalSubcategory>(() =>
    searchParams.get('section') === 'law_reference' ? 'law_reference' : 'consultation'
  );
  const [activeCategory, setActiveCategory] = useState<NoteCategory>(() => {
    const tab = searchParams.get('tab');
    return tab === 'eviction_quote' || tab === 'legal_support' || tab === 'cooperation' ? tab : 'community';
  });

  // 작성 폼
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [formAnonymous, setFormAnonymous] = useState(false);
  const [formVisibility, setFormVisibility] = useState('all');
  const [formCourt, setFormCourt] = useState(COURTS[0]);
  const [formCaseNumber, setFormCaseNumber] = useState('');
  const [formLegalSubcategory, setFormLegalSubcategory] = useState<LegalSubcategory>('consultation');
  const [formAttachments, setFormAttachments] = useState<NoteAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 수정 모드
  const [editingId, setEditingId] = useState<string | null>(null);

  // 상세 보기
  const [detail, setDetail] = useState<Note | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentAnonymous, setCommentAnonymous] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);

  // const isAdmin = !!user && ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role); // 현재 미사용
  const isManager = !!user && ['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user.role);
  const isMaster = user?.role === 'master';

  // 공유 범위 옵션: 역할에 따라 다름
  const teamOptions = departments.map(d => ({ value: `team:${d}`, label: `${d}` }));
  const visibilityOptions = isManager
    ? [
        { value: 'all', label: '전체 공유' },
        { value: 'branch', label: `지사 (${user?.branch || '소속 지사'})` },
        { value: 'department', label: `내 팀 (${user?.department || '소속 팀'})` },
        ...teamOptions,
      ]
    : [
        { value: 'branch', label: `지사 (${user?.branch || '소속 지사'})` },
        { value: 'department', label: `내 팀 (${user?.department || '소속 팀'})` },
        ...teamOptions,
      ];

  const load = async () => {
    if (activeCategory === 'cooperation') {
      setNotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.adminNotes.list({
        category: activeCategory,
        search,
        legal_subcategory: activeCategory === 'legal_support' ? activeLegalSubcategory : undefined,
      });
      setNotes(res.notes);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => {
    const tab = searchParams.get('tab');
    const next = tab === 'eviction_quote' || tab === 'legal_support' || tab === 'cooperation' ? tab : 'community';
    const nextLegalSubcategory = searchParams.get('section') === 'law_reference' ? 'law_reference' : 'consultation';
    if (next === 'legal_support' && nextLegalSubcategory !== activeLegalSubcategory) {
      setActiveLegalSubcategory(nextLegalSubcategory);
      setFormLegalSubcategory(nextLegalSubcategory);
    }
    if (next !== activeCategory) {
      setActiveCategory(next);
      setActiveLegalSubcategory(nextLegalSubcategory);
      setDetail(null);
      resetForm();
    }
  }, [searchParams]);

  useEffect(() => { load(); }, [activeCategory, activeLegalSubcategory]);

  const openDetail = async (note: Note) => {
    setDetail(note);
    try {
      const res = await api.adminNotes.get(note.id);
      setDetail(res.note);
      setComments(res.comments);
      setAttachments(res.attachments || []);
    } catch { /* */ }
  };

  const readFiles = async (files: FileList | File[]) => {
    const picked = Array.from(files).slice(0, Math.max(0, 5 - formAttachments.length));
    const converted = await Promise.all(picked.map(file => new Promise<NoteAttachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: crypto.randomUUID(),
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        file_data: String(reader.result || ''),
      });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setFormAttachments(prev => [...prev, ...converted].slice(0, 5));
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) await readFiles(files);
  };

  const handleCreate = async () => {
    if (activeCategory !== 'eviction_quote' && !formTitle.trim()) { alert('제목을 입력하세요.'); return; }
    if (activeCategory === 'eviction_quote' && !formCaseNumber.trim()) { alert('사건번호를 입력하세요.'); return; }
    if (!formContent.trim()) { alert('내용을 입력하세요.'); return; }
    setSubmitting(true);
    try {
      const title = activeCategory === 'eviction_quote'
        ? `${formCourt} ${formCaseNumber.trim()} 명도 견적 의뢰`
        : formTitle.trim();
      if (editingId) {
        await api.adminNotes.update(editingId, { title, content: formContent.trim(), pinned: formPinned });
        if (detail?.id === editingId) {
          const res = await api.adminNotes.get(editingId);
          setDetail(res.note);
          setAttachments(res.attachments || []);
        }
      } else {
        await api.adminNotes.create({
          title,
          content: formContent.trim(),
          pinned: formPinned,
          is_anonymous: activeCategory === 'legal_support' ? formAnonymous : formAnonymous,
          visibility: activeCategory === 'community' ? formVisibility : 'all',
          category: activeCategory,
          court: activeCategory === 'eviction_quote' ? formCourt : undefined,
          case_number: activeCategory === 'eviction_quote' ? formCaseNumber.trim() : undefined,
          legal_subcategory: activeCategory === 'legal_support' ? formLegalSubcategory : undefined,
          attachments: activeCategory === 'legal_support' ? formAttachments : [],
        });
      }
      resetForm();
      await load();
    } catch (err: any) { alert(err.message); }
    setSubmitting(false);
  };

  const resetForm = () => {
    setFormTitle(''); setFormContent(''); setFormPinned(false);
    setFormAnonymous(false); setFormVisibility(isManager ? 'all' : 'branch');
    setFormCourt(COURTS[0]); setFormCaseNumber(''); setFormLegalSubcategory(activeLegalSubcategory); setFormAttachments([]);
    setShowForm(false); setEditingId(null);
  };

  const startEdit = (note: Note) => {
    setFormTitle(note.title);
    setFormContent(note.content);
    setFormPinned(!!note.pinned);
    setFormCourt(note.court || COURTS[0]);
    setFormCaseNumber(note.case_number || '');
    setFormLegalSubcategory((note.legal_subcategory || 'consultation') as LegalSubcategory);
    setEditingId(note.id);
    setShowForm(true);
    setDetail(null);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`"${title}" 게시글을 삭제하시겠습니까?`)) return;
    try {
      await api.adminNotes.delete(id);
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !detail) return;
    setCommentLoading(true);
    try {
      await api.adminNotes.addComment(detail.id, commentText.trim(), commentAnonymous);
      setCommentText('');
      setCommentAnonymous(false);
      const res = await api.adminNotes.get(detail.id);
      setComments(res.comments);
      setDetail(res.note);
      await load();
    } catch (err: any) { alert(err.message); }
    setCommentLoading(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    try {
      await api.adminNotes.deleteComment(commentId);
      setComments(comments.filter(c => c.id !== commentId));
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handlePrintDetail = () => {
    if (!detail) return;
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) {
      window.print();
      return;
    }
    const commentHtml = comments.length
      ? comments.map(c => `
        <div class="comment">
          <div class="comment-meta">${escapeHtml(authorLabel(c))} · ${escapeHtml(formatDate(c.created_at))}</div>
          <div class="comment-body">${escapeHtml(c.content)}</div>
        </div>
      `).join('')
      : '<div class="empty">댓글 없음</div>';
    const attachmentHtml = attachments.length
      ? attachments.map(file => `<div class="attachment">${escapeHtml(file.file_name)}</div>`).join('')
      : '';
    popup.document.write(`<!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(detail.title)}</title>
        <style>
          body { font-family: Arial, "Malgun Gothic", sans-serif; color: #202124; padding: 28px; line-height: 1.65; }
          h1 { font-size: 22px; margin: 0 0 12px; }
          .meta { display: flex; flex-wrap: wrap; gap: 8px 14px; color: #5f6368; font-size: 12px; border-bottom: 1px solid #dadce0; padding-bottom: 14px; margin-bottom: 18px; }
          .badge { padding: 2px 8px; border: 1px solid #dadce0; border-radius: 999px; }
          .content { white-space: pre-wrap; word-break: break-word; font-size: 14px; margin-bottom: 24px; }
          h2 { font-size: 15px; margin: 24px 0 10px; border-top: 1px solid #e8eaed; padding-top: 14px; }
          .comment { padding: 10px 0; border-bottom: 1px solid #f1f3f4; }
          .comment-meta { color: #5f6368; font-size: 12px; margin-bottom: 4px; }
          .comment-body { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
          .attachment, .empty { color: #5f6368; font-size: 12px; }
          @page { margin: 16mm; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(detail.title)}</h1>
        <div class="meta">
          <span>${escapeHtml(authorLabel(detail))}</span>
          <span>${escapeHtml(formatDate(detail.created_at))}</span>
          <span class="badge">${escapeHtml(getVisibilityLabel(detail.visibility))}</span>
          ${detail.category === 'eviction_quote' ? `<span class="badge">법원: ${escapeHtml(detail.court || '-')}</span><span class="badge">사건번호: ${escapeHtml(detail.case_number || '-')}</span>` : ''}
          ${detail.category === 'legal_support' ? `<span class="badge">${escapeHtml(getLegalSubcategoryLabel(detail.legal_subcategory))}</span>` : ''}
        </div>
        <div class="content">${escapeHtml(detail.content)}</div>
        ${attachmentHtml ? `<h2>첨부</h2>${attachmentHtml}` : ''}
        <h2>${isLegalConsultation(detail) ? '답변' : '댓글'} ${comments.length ? `(${comments.length})` : ''}</h2>
        ${commentHtml}
        <script>window.onload = () => { window.print(); window.close(); };</script>
      </body>
      </html>`);
    popup.document.close();
  };

  const filtered = notes.filter(n =>
    n.title.includes(search) || n.content.includes(search) || (n.author_name || '').includes(search) || (n.court || '').includes(search) || (n.case_number || '').includes(search)
  );

  if (loading) return <div className="page-loading">로딩중...</div>;

  // 상세 보기
  if (detail) {
    const canEdit = detail.author_id === user?.id || isMaster;
    return (
      <div className="page">
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setDetail(null)}><ArrowLeft size={14} /> 목록</button>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>
              {detail.pinned ? <Pin size={14} style={{ color: 'var(--primary)', marginRight: 4 }} /> : null}
              {detail.title}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={handlePrintDetail}><Printer size={13} /> 프린트</button>
            {canEdit && (
              <>
                <button className="btn btn-sm" onClick={() => startEdit(detail)}><Edit3 size={13} /> 수정</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(detail.id, detail.title)}><Trash2 size={13} /> 삭제</button>
              </>
            )}
          </div>
        </div>

        <div className="admin-note-detail">
          <div className="admin-note-detail-meta">
            <span className="admin-note-author-tag">
              {detail.is_anonymous ? <EyeOff size={12} style={{ marginRight: 3, verticalAlign: 'middle' }} /> : null}
              {authorLabel(detail)}
            </span>
            <span>{formatDate(detail.created_at)}</span>
            {detail.updated_at !== detail.created_at && <span>(수정됨)</span>}
            {detail.source_type === 'minutes' && (
              <span className="admin-note-source-badge"><BookOpen size={11} /> 회의록</span>
            )}
            <span className="admin-note-visibility-badge">{getVisibilityLabel(detail.visibility)}</span>
          </div>
          {detail.category === 'eviction_quote' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 0' }}>
              <span className="admin-note-visibility-badge">법원: {detail.court || '-'}</span>
              <span className="admin-note-visibility-badge">사건번호: {detail.case_number || '-'}</span>
            </div>
          )}
          {detail.category === 'legal_support' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 0' }}>
              <span className="admin-note-visibility-badge">{getLegalSubcategoryLabel(detail.legal_subcategory)}</span>
            </div>
          )}
          {isLegalConsultation(detail) && (
            <div className="admin-note-editor-label">질문 내용</div>
          )}
          <div className={`admin-note-detail-content ${detail.category === 'legal_support' ? 'legal-question-editor' : ''}`}>{detail.content}</div>
          {attachments.length > 0 && (
            <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
              {attachments.map(file => (
                <a key={file.id} href={file.file_data} download={file.file_name} className="btn btn-sm" style={{ justifyContent: 'flex-start', width: 'fit-content' }}>
                  <Download size={13} /> {file.file_name}
                </a>
              ))}
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {attachments.filter(file => file.file_type?.startsWith('image/')).map(file => (
                  <img key={file.id + '-preview'} src={file.file_data} alt={file.file_name} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid #e0e0e0' }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 댓글/답변 */}
        <div className={`admin-note-comments ${detail.category === 'legal_support' ? 'legal-answer-section' : ''}`}>
          <h3 style={{ fontSize: '0.88rem', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <MessageSquare size={15} /> {isLegalConsultation(detail) ? '답변' : '댓글'} {comments.length > 0 && `(${comments.length})`}
          </h3>
          {comments.map(c => (
            <div key={c.id} className={`admin-note-comment ${detail.category === 'legal_support' ? 'legal-answer-card' : ''}`}>
              <div className="admin-note-comment-header">
                <span className="admin-note-comment-author">
                  {c.is_anonymous ? <EyeOff size={10} style={{ marginRight: 2 }} /> : null}
                  {authorLabel(c)}
                </span>
                <span className="admin-note-comment-date">{formatDate(c.created_at)}</span>
                {(c.author_id === user?.id || isMaster) && (
                  <button className="btn-icon-sm" onClick={() => handleDeleteComment(c.id)} title="삭제">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <div className={`admin-note-comment-body ${detail.category === 'legal_support' ? 'legal-answer-body' : ''}`}>{c.content}</div>
            </div>
          ))}
          <div className={`admin-note-comment-form ${detail.category === 'legal_support' ? 'legal-answer-form' : detail.category === 'eviction_quote' ? 'eviction-quote-comment-form' : 'community-comment-form'}`}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#5f6368', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={commentAnonymous} onChange={(e) => setCommentAnonymous(e.target.checked)} />
              <EyeOff size={12} /> 익명
            </label>
            <textarea
              className="form-input"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={isLegalConsultation(detail) ? '답변을 작성하세요...' : detail.category === 'eviction_quote' ? '정액제 금액 제안 또는 댓글을 입력하세요...' : '댓글을 입력하세요...'}
              onKeyDown={(e) => { if (!isLegalConsultation(detail) && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
              rows={isLegalConsultation(detail) ? 12 : detail.category === 'eviction_quote' ? 6 : 4}
              style={{ minHeight: isLegalConsultation(detail) ? 260 : detail.category === 'eviction_quote' ? 150 : 112, resize: 'vertical' }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleAddComment} disabled={commentLoading || !commentText.trim()}>
              <Send size={13} /> {isLegalConsultation(detail) ? '답변 등록' : ''}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 목록
  return (
    <div className="page">
      <div className="page-header">
        <h2><StickyNote size={20} style={{ marginRight: 6, verticalAlign: 'middle' }} />사내 커뮤니티</h2>
        {activeCategory !== 'cooperation' && (
          <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}>
            {showForm ? <><X size={14} /> 취소</> : <><Plus size={14} /> 새 게시글</>}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`btn btn-sm ${activeCategory === key ? 'btn-primary' : ''}`}
            onClick={() => {
              setActiveCategory(key);
              setDetail(null);
              resetForm();
              setSearchParams(key === 'community' ? {} : key === 'legal_support' ? { tab: key, section: activeLegalSubcategory } : { tab: key });
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {activeCategory === 'cooperation' && <Cooperation embedded />}

      {activeCategory !== 'cooperation' && <>
      {activeCategory === 'legal_support' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {LEGAL_SUBCATEGORIES.map(item => (
            <button
              key={item.key}
              className={`btn btn-sm ${activeLegalSubcategory === item.key ? 'btn-primary' : ''}`}
              onClick={() => {
                setActiveLegalSubcategory(item.key);
                setFormLegalSubcategory(item.key);
                setDetail(null);
                setSearchParams({ tab: 'legal_support', section: item.key });
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: activeCategory === 'legal_support' ? 'center' : 'flex-start', margin: activeCategory === 'legal_support' ? '18px 0 22px' : '0 0 12px' }}>
          <div style={activeCategory === 'legal_support'
            ? { display: 'flex', alignItems: 'center', width: 'min(520px, 100%)', border: '3px solid var(--primary)', borderRadius: 999, overflow: 'hidden', background: '#fff' }
            : { display: 'flex', alignItems: 'center', width: 'min(360px, 100%)', border: '1px solid #dadce0', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
              placeholder={activeCategory === 'eviction_quote' ? '법원, 사건번호, 내용 검색...' : activeCategory === 'legal_support' ? '궁금한 법률 내용을 검색하세요' : '제목, 내용, 작성자 검색...'}
              style={{ flex: 1, border: 'none', outline: 'none', padding: activeCategory === 'legal_support' ? '12px 18px' : '8px 12px', fontSize: activeCategory === 'legal_support' ? 15 : 13 }}
            />
            <button onClick={load} aria-label="검색" style={{ width: activeCategory === 'legal_support' ? 66 : 44, alignSelf: 'stretch', border: 'none', background: activeCategory === 'legal_support' ? 'var(--primary)' : '#f8f9fa', color: activeCategory === 'legal_support' ? '#fff' : '#5f6368', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <Search size={activeCategory === 'legal_support' ? 28 : 18} strokeWidth={activeCategory === 'legal_support' ? 3 : 2} />
            </button>
          </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>
            {editingId ? '게시글 수정' : activeCategory === 'eviction_quote' ? '명도 견적 의뢰' : activeCategory === 'legal_support' ? `${getLegalSubcategoryLabel(formLegalSubcategory)} 작성` : '새 게시글 작성'}
          </h3>
          {activeCategory === 'eviction_quote' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>법원 *</label>
                <select className="form-input" value={formCourt} onChange={(e) => setFormCourt(e.target.value)} style={{ width: '100%' }}>
                  {COURTS.map(court => <option key={court} value={court}>{court}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>사건번호 *</label>
                <input className="form-input" value={formCaseNumber} onChange={(e) => setFormCaseNumber(e.target.value)} placeholder="예: 2026타경12345" style={{ width: '100%' }} />
              </div>
            </div>
          ) : (
            <>
              {activeCategory === 'legal_support' && !editingId && (
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label>분류</label>
                  <select className="form-input" value={formLegalSubcategory} onChange={(e) => setFormLegalSubcategory(e.target.value as LegalSubcategory)} style={{ width: 180 }}>
                    {LEGAL_SUBCATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>{activeCategory === 'legal_support' && formLegalSubcategory === 'consultation' ? '질문 제목 *' : '제목 *'}</label>
                <input className="form-input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder={activeCategory === 'legal_support' && formLegalSubcategory === 'consultation' ? '질문 제목' : '게시글 제목'} style={{ width: '100%' }} />
              </div>
            </>
          )}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>{activeCategory === 'legal_support' && formLegalSubcategory === 'consultation' ? '질문 내용 *' : '내용 *'}</label>
            <textarea className="form-input" value={formContent} onChange={(e) => setFormContent(e.target.value)}
              onPaste={activeCategory === 'legal_support' ? handlePaste : undefined}
              placeholder={activeCategory === 'eviction_quote' ? '현장 상황, 점유자 정보, 특이사항 등을 입력하세요.' : activeCategory === 'legal_support' && formLegalSubcategory === 'consultation' ? '질문 내용을 입력하세요. 이미지는 붙여넣기로 추가할 수 있습니다.' : activeCategory === 'legal_support' ? '법령명, 조문, 실무 메모를 입력하세요.' : '게시글 내용을 입력하세요...'}
              rows={6} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          {activeCategory === 'legal_support' && (
            <div style={{ marginBottom: 12 }}>
              <label className="btn btn-sm" style={{ width: 'fit-content' }}>
                <Paperclip size={13} /> 첨부파일 추가
                <input type="file" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files) readFiles(e.target.files); e.currentTarget.value = ''; }} />
              </label>
              {formAttachments.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {formAttachments.map(file => (
                    <span key={file.id} className="admin-note-visibility-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {file.file_name}
                      <button className="btn-icon-sm" onClick={() => setFormAttachments(prev => prev.filter(f => f.id !== file.id))} title="첨부 제거"><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {!editingId && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              {activeCategory === 'community' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.8rem', marginBottom: 4, display: 'block' }}>공유 범위</label>
                  <select className="form-input" value={formVisibility} onChange={(e) => setFormVisibility(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: '0.82rem', minWidth: 180 }}>
                    {visibilityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              {(activeCategory === 'community' || activeCategory === 'legal_support') && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.82rem', marginTop: activeCategory === 'community' ? 18 : 0 }}>
                  <input type="checkbox" checked={formAnonymous} onChange={(e) => setFormAnonymous(e.target.checked)} />
                  <EyeOff size={13} /> 익명으로 작성
                </label>
              )}
              {user?.role === 'master' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.82rem', marginTop: 18 }}>
                  <input type="checkbox" checked={formPinned} onChange={(e) => setFormPinned(e.target.checked)} />
                  <Pin size={13} /> 상단 고정
                </label>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? '저장 중...' : editingId ? '수정' : '등록'}
            </button>
            <button className="btn" onClick={resetForm}>취소</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          {notes.length === 0 ? '등록된 게시글이 없습니다.' : '검색 결과가 없습니다.'}
        </div>
      ) : (
        <div className="admin-notes-list">
          {filtered.map((note) => (
            <div key={note.id} className={`admin-notes-card ${note.pinned ? 'pinned' : ''}`} onClick={() => openDetail(note)}>
              <div className="admin-notes-card-body">
                <div className="admin-notes-card-title">
                  {note.pinned ? <Pin size={13} className="pin-icon" /> : null}
                  {note.source_type === 'minutes' && <BookOpen size={13} style={{ color: '#1a73e8', flexShrink: 0 }} />}
                  {note.category === 'eviction_quote' && <Gavel size={13} style={{ color: '#1a73e8', flexShrink: 0 }} />}
                  {note.category === 'legal_support' && <Scale size={13} style={{ color: '#1a73e8', flexShrink: 0 }} />}
                  {note.is_anonymous ? <EyeOff size={12} style={{ color: '#9aa0a6', flexShrink: 0 }} /> : null}
                  {note.title}
                </div>
                {note.category === 'eviction_quote' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 6px' }}>
                    <span className="admin-note-visibility-badge">{note.court || '-'}</span>
                    <span className="admin-note-visibility-badge">{note.case_number || '-'}</span>
                  </div>
                )}
                {note.category === 'legal_support' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 6px' }}>
                    <span className="admin-note-visibility-badge">{getLegalSubcategoryLabel(note.legal_subcategory)}</span>
                  </div>
                )}
                <div className="admin-notes-card-preview">
                  {note.content.length > 100 ? note.content.slice(0, 100) + '...' : note.content}
                </div>
                <div className="admin-notes-card-meta">
                  <span>{authorLabel(note)}</span>
                  <span>{formatDate(note.created_at)}</span>
                  <span className="admin-note-visibility-badge">{getVisibilityLabel(note.visibility)}</span>
                  {note.comment_count > 0 && (
                    <span className="comment-badge"><MessageSquare size={11} /> {note.comment_count}</span>
                  )}
                  {!!note.attachment_count && (
                    <span className="comment-badge"><Paperclip size={11} /> {note.attachment_count}</span>
                  )}
                </div>
              </div>
              <div className="admin-notes-card-actions" onClick={(e) => e.stopPropagation()}>
                {(note.author_id === user?.id || isMaster) && (
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(note.id, note.title)} title="삭제">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}
