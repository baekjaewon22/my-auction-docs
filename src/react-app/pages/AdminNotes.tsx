import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { useDepartments } from '../hooks/useDepartments';
import { StickyNote, Plus, X, Trash2, ArrowLeft, Pin, MessageSquare, Send, Edit3, BookOpen, EyeOff } from 'lucide-react';

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

function authorLabel(item: { display_name?: string; author_name?: string; author_position?: string; is_anonymous?: number }) {
  if (item.display_name) return item.display_name;
  if (item.author_position) return `${item.author_name} / ${item.author_position}`;
  return item.author_name || '익명';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getVisibilityLabel(v: string): string {
  if (v === 'all') return '전체';
  if (v === 'branch') return '지사';
  if (v === 'department') return '팀';
  if (v.startsWith('team:')) return v.replace('team:', '');
  return '전체';
}

export default function AdminNotes() {
  const { user } = useAuthStore();
  const { departments } = useDepartments();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // 작성 폼
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [formAnonymous, setFormAnonymous] = useState(false);
  const [formVisibility, setFormVisibility] = useState('all');
  const [submitting, setSubmitting] = useState(false);

  // 수정 모드
  const [editingId, setEditingId] = useState<string | null>(null);

  // 상세 보기
  const [detail, setDetail] = useState<Note | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
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
    try {
      const res = await api.adminNotes.list();
      setNotes(res.notes);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (note: Note) => {
    setDetail(note);
    try {
      const res = await api.adminNotes.get(note.id);
      setDetail(res.note);
      setComments(res.comments);
    } catch { /* */ }
  };

  const handleCreate = async () => {
    if (!formTitle.trim()) { alert('제목을 입력하세요.'); return; }
    if (!formContent.trim()) { alert('내용을 입력하세요.'); return; }
    setSubmitting(true);
    try {
      if (editingId) {
        await api.adminNotes.update(editingId, { title: formTitle.trim(), content: formContent.trim(), pinned: formPinned });
        if (detail?.id === editingId) {
          const res = await api.adminNotes.get(editingId);
          setDetail(res.note);
        }
      } else {
        await api.adminNotes.create({
          title: formTitle.trim(),
          content: formContent.trim(),
          pinned: formPinned,
          is_anonymous: formAnonymous,
          visibility: formVisibility,
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
    setShowForm(false); setEditingId(null);
  };

  const startEdit = (note: Note) => {
    setFormTitle(note.title);
    setFormContent(note.content);
    setFormPinned(!!note.pinned);
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

  const filtered = notes.filter(n =>
    n.title.includes(search) || n.content.includes(search) || (n.author_name || '').includes(search)
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
          <div className="admin-note-detail-content">{detail.content}</div>
        </div>

        {/* 댓글 */}
        <div className="admin-note-comments">
          <h3 style={{ fontSize: '0.88rem', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <MessageSquare size={15} /> 댓글 {comments.length > 0 && `(${comments.length})`}
          </h3>
          {comments.map(c => (
            <div key={c.id} className="admin-note-comment">
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
              <div className="admin-note-comment-body">{c.content}</div>
            </div>
          ))}
          <div className="admin-note-comment-form">
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#5f6368', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={commentAnonymous} onChange={(e) => setCommentAnonymous(e.target.checked)} />
              <EyeOff size={12} /> 익명
            </label>
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="댓글을 입력하세요..."
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleAddComment} disabled={commentLoading || !commentText.trim()}>
              <Send size={13} />
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
        <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}>
          {showForm ? <><X size={14} /> 취소</> : <><Plus size={14} /> 새 게시글</>}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>{editingId ? '게시글 수정' : '새 게시글 작성'}</h3>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>제목 *</label>
            <input className="form-input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="게시글 제목" style={{ width: '100%' }} />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>내용 *</label>
            <textarea className="form-input" value={formContent} onChange={(e) => setFormContent(e.target.value)}
              placeholder="게시글 내용을 입력하세요..." rows={6} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          {!editingId && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem', marginBottom: 4, display: 'block' }}>공유 범위</label>
                <select className="form-input" value={formVisibility} onChange={(e) => setFormVisibility(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: '0.82rem', minWidth: 180 }}>
                  {visibilityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.82rem', marginTop: 18 }}>
                <input type="checkbox" checked={formAnonymous} onChange={(e) => setFormAnonymous(e.target.checked)} />
                <EyeOff size={13} /> 익명으로 작성
              </label>
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

      <div style={{ marginBottom: 12 }}>
        <input
          className="search-input"
          placeholder="제목, 내용, 작성자 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300, padding: '6px 12px', border: '1px solid #dadce0', borderRadius: 6, fontSize: '0.8rem' }}
        />
      </div>

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
                  {note.is_anonymous ? <EyeOff size={12} style={{ color: '#9aa0a6', flexShrink: 0 }} /> : null}
                  {note.title}
                </div>
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
    </div>
  );
}
