import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import { FontSize, FONT_SIZES, FONT_SIZE_LABELS } from '../extensions/FontSize';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { Document, DocumentLog, Signature } from '../types';
import SignaturePanel from '../components/SignaturePanel';
import type { SignatureType } from '../components/SignaturePanel';
import ApprovalBar from '../components/ApprovalBar';
import { FileDown } from 'lucide-react';

export default function DocumentEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [doc, setDoc] = useState<Document | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [logs, setLogs] = useState<DocumentLog[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signatureType, setSignatureType] = useState<SignatureType>('author');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '문서 내용을 입력하세요...' }),
      Highlight,
      TextStyle,
      Color,
      FontSize,
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content: '',
    editable: false,
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        autoSave(editor.getHTML());
      }, 1500);
    },
  });

  const isEditable = doc && (doc.status === 'draft' || doc.status === 'rejected') &&
    (doc.author_id === user?.id || user?.role === 'master');

  const canApprove = doc && doc.status === 'submitted' &&
    ['master', 'ceo', 'admin', 'manager'].includes(user?.role || '');

  const mySigned = signatures.some((s) => s.user_id === user?.id);

  const autoSave = useCallback(async (content: string) => {
    if (!id || !isEditable) return;
    setSaving(true);
    try {
      await api.documents.update(id, { title, content });
      setLastSaved(new Date());
    } catch { /* ignore */ }
    setSaving(false);
  }, [id, title, isEditable]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.documents.get(id),
      api.documents.logs(id),
      api.signatures.getByDocument(id),
    ]).then(([docRes, logRes, sigRes]) => {
      const d = docRes.document;
      setDoc(d);
      setTitle(d.title);
      setLogs(logRes.logs);
      setSignatures(sigRes.signatures);
      if (editor) {
        editor.commands.setContent(d.content === '{}' ? '' : d.content);
        const canEdit = (d.status === 'draft' || d.status === 'rejected') &&
          (d.author_id === user?.id || user?.role === 'master');
        editor.setEditable(canEdit);
      }
    }).catch(() => navigate('/documents'));
  }, [id, editor]);

  const handleTitleBlur = () => {
    if (!id || !isEditable) return;
    api.documents.update(id, { title });
    setLastSaved(new Date());
  };

  const handleSubmit = async () => {
    if (!id) return;
    if (!mySigned) {
      alert('제출 전 작성자 서명이 필요합니다.\n결재란에서 서명을 완료해주세요.');
      return;
    }
    if (!confirm('서명이 완료된 문서를 최종 제출하시겠습니까?\n제출 후에는 수정할 수 없습니다.')) return;
    if (editor) {
      await api.documents.update(id, { title, content: editor.getHTML() });
    }
    await api.documents.submit(id);
    window.location.reload();
  };

  const handleApprove = async () => {
    if (!id) return;
    await api.documents.approve(id);
    window.location.reload();
  };

  const handleReject = async () => {
    if (!id) return;
    await api.documents.reject(id, rejectReason);
    window.location.reload();
  };

  // PDF 출력
  const handleExportPdf = async () => {
    const html2pdf = (await import('html2pdf.js')).default;
    const editorEl = document.querySelector('.editor-area');
    if (!editorEl) return;

    // Build PDF content with signature header
    const pdfContainer = document.createElement('div');
    pdfContainer.style.cssText = 'font-family: "Segoe UI", sans-serif; color: #202124;';

    // 우측 상단 결재란
    const sigHeader = document.createElement('div');
    sigHeader.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 20px;';

    const sigTable = document.createElement('table');
    sigTable.style.cssText = 'border-collapse: collapse; font-size: 10px;';

    const headerRow = document.createElement('tr');
    ['작성자', '팀장', '대표'].forEach((label) => {
      const th = document.createElement('th');
      th.style.cssText = 'border: 1px solid #999; padding: 4px 12px; background: #f5f5f5; font-size: 10px; width: 70px; text-align: center;';
      th.textContent = label;
      headerRow.appendChild(th);
    });
    sigTable.appendChild(headerRow);

    const dataRow = document.createElement('tr');
    [0, 1, 2].forEach((idx) => {
      const td = document.createElement('td');
      td.style.cssText = 'border: 1px solid #999; padding: 4px; height: 50px; width: 70px; text-align: center; vertical-align: middle;';
      const sig = signatures[idx];
      if (sig) {
        const img = document.createElement('img');
        img.src = sig.signature_data;
        img.style.cssText = 'width: 55px; height: 28px; object-fit: contain;';
        td.appendChild(img);
        const name = document.createElement('div');
        name.style.cssText = 'font-size: 8px; color: #666; margin-top: 2px;';
        name.textContent = sig.user_name || '';
        td.appendChild(name);
      }
      dataRow.appendChild(td);
    });
    sigTable.appendChild(dataRow);
    sigHeader.appendChild(sigTable);
    pdfContainer.appendChild(sigHeader);

    // 문서 제목
    const titleEl = document.createElement('h2');
    titleEl.style.cssText = 'text-align: center; margin-bottom: 16px; font-size: 18px;';
    titleEl.textContent = title;
    pdfContainer.appendChild(titleEl);

    // 문서 본문
    const content = document.createElement('div');
    content.innerHTML = editor?.getHTML() || '';
    content.style.cssText = 'font-size: 12px; line-height: 1.6;';
    pdfContainer.appendChild(content);

    document.body.appendChild(pdfContainer);

    await (html2pdf().set as any)({
      margin: [15, 15, 15, 15],
      filename: `${title || '문서'}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(pdfContainer).save();

    document.body.removeChild(pdfContainer);
  };

  // ApprovalBar에서 서명 버튼 클릭 시
  const handleApprovalSign = (type: 'author' | 'approver') => {
    setSignatureType(type);
    setShowSignature(true);
  };

  // 서명 완료 - 결재란에만 반영 (문서 본문은 건드리지 않음)
  const handleSignComplete = (_signatureData: string, _type: SignatureType) => {
    if (!id) return;
    api.signatures.getByDocument(id).then((res) => setSignatures(res.signatures));
    setShowSignature(false);
  };

  if (!doc) return <div className="page-loading">로딩중...</div>;

  const statusConfig: Record<string, { label: string; className: string }> = {
    draft: { label: '작성중', className: 'status-draft' },
    submitted: { label: '제출', className: 'status-submitted' },
    approved: { label: '승인', className: 'status-approved' },
    rejected: { label: '반려', className: 'status-rejected' },
  };

  return (
    <div className="page editor-page">
      {/* Editor Header */}
      <div className="editor-header">
        <div className="editor-header-left">
          <button className="btn btn-sm" onClick={() => navigate('/documents')}>← 목록</button>
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            disabled={!isEditable}
            placeholder="문서 제목"
          />
          <span className={`status-badge ${statusConfig[doc.status]?.className}`}>
            {statusConfig[doc.status]?.label}
          </span>
        </div>
        <div className="editor-header-right">
          {saving && <span className="save-indicator">저장중...</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              자동 저장됨 {lastSaved.toLocaleTimeString('ko-KR')}
            </span>
          )}
          <button className="btn btn-sm" onClick={() => setShowLogs(!showLogs)}>이력</button>
          <button className="btn btn-sm" onClick={handleExportPdf} title="PDF 다운로드"><FileDown size={14} /> PDF</button>

          {/* Draft/Rejected: 최종 제출 (서명은 결재란에서) */}
          {isEditable && (doc.status === 'draft' || doc.status === 'rejected') && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSubmit}
              disabled={!mySigned}
              title={!mySigned ? '결재란에서 작성자 서명을 먼저 완료하세요' : ''}
            >
              {doc.status === 'rejected' ? '재제출' : '최종 제출'}
            </button>
          )}

          {canApprove && (
            <>
              <button className="btn btn-success btn-sm" onClick={handleApprove}>승인</button>
              <button className="btn btn-danger btn-sm" onClick={() => setShowReject(true)}>반려</button>
            </>
          )}
        </div>
      </div>

      {/* Reject reason banner */}
      {doc.status === 'rejected' && doc.reject_reason && (
        <div className="alert alert-error">반려 사유: {doc.reject_reason}</div>
      )}

      {/* Reject modal */}
      {showReject && (
        <div className="modal-overlay" onClick={() => setShowReject(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>문서 반려</h3>
            <div className="form-group">
              <label>반려 사유</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="반려 사유를 입력하세요"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowReject(false)}>취소</button>
              <button className="btn btn-danger" onClick={handleReject}>반려</button>
            </div>
          </div>
        </div>
      )}

      <div className="editor-body">
        {/* ── 고정 결재란 (에디터 위) ── */}
        <ApprovalBar
          signatures={signatures}
          currentUserId={user?.id}
          currentUserRole={user?.role}
          docStatus={doc.status}
          onSign={handleApprovalSign}
        />

        {/* TipTap Toolbar */}
        {isEditable && editor && (
          <div className="toolbar">
            <button className="toolbar-btn" onClick={() => { const c = editor.getAttributes('textStyle').fontSize || '16px'; const i = FONT_SIZES.indexOf(c); if (i > 0) editor.chain().focus().setFontSize(FONT_SIZES[i - 1]).run(); }} title="글자 크기 줄이기">A−</button>
            <select className="toolbar-select" value={editor.getAttributes('textStyle').fontSize || ''} onChange={(e) => { if (e.target.value) editor.chain().focus().setFontSize(e.target.value).run(); else editor.chain().focus().unsetFontSize().run(); }} title="글자 크기">
              <option value="">크기</option>
              {FONT_SIZES.map((size) => (<option key={size} value={size}>{FONT_SIZE_LABELS[size]}pt</option>))}
            </select>
            <button className="toolbar-btn" onClick={() => { const c = editor.getAttributes('textStyle').fontSize || '16px'; const i = FONT_SIZES.indexOf(c); if (i < FONT_SIZES.length - 1) editor.chain().focus().setFontSize(FONT_SIZES[i + 1]).run(); else if (i === -1) editor.chain().focus().setFontSize('18px').run(); }} title="글자 크기 키우기">A+</button>
            <span className="toolbar-divider" />
            <button className={`toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게"><strong>B</strong></button>
            <button className={`toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="기울임"><em>I</em></button>
            <button className={`toolbar-btn ${editor.isActive('underline') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄"><u>U</u></button>
            <button className={`toolbar-btn ${editor.isActive('strike') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선"><s>S</s></button>
            <span className="toolbar-divider" />
            <button className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
            <button className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
            <button className={`toolbar-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
            <span className="toolbar-divider" />
            <button className={`toolbar-btn ${editor.isActive('bulletList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}>• 목록</button>
            <button className={`toolbar-btn ${editor.isActive('orderedList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. 목록</button>
            <span className="toolbar-divider" />
            <button className={`toolbar-btn ${editor.isActive({ textAlign: 'left' }) ? 'active' : ''}`} onClick={() => editor.chain().focus().setTextAlign('left').run()}>좌</button>
            <button className={`toolbar-btn ${editor.isActive({ textAlign: 'center' }) ? 'active' : ''}`} onClick={() => editor.chain().focus().setTextAlign('center').run()}>중</button>
            <button className={`toolbar-btn ${editor.isActive({ textAlign: 'right' }) ? 'active' : ''}`} onClick={() => editor.chain().focus().setTextAlign('right').run()}>우</button>
            <span className="toolbar-divider" />
            <button className={`toolbar-btn ${editor.isActive('blockquote') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBlockquote().run()}>인용</button>
            <button className={`toolbar-btn ${editor.isActive('codeBlock') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>코드</button>
            <button className="toolbar-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()}>─</button>
            <span className="toolbar-divider" />
            <button className="toolbar-btn" onClick={() => editor.chain().focus().undo().run()}>↩</button>
            <button className="toolbar-btn" onClick={() => editor.chain().focus().redo().run()}>↪</button>
          </div>
        )}

        {/* Editor Content */}
        <div className="editor-content-wrapper">
          <div className="editor-page-container">
            <EditorContent editor={editor} className="editor-area" />
            <PageNumbers />
          </div>
        </div>

        {/* Sidebar: Logs */}
        {showLogs && (
          <div className="side-panel">
            <div className="side-panel-header">
              <h4>문서 이력</h4>
              <button className="btn-close" onClick={() => setShowLogs(false)}>×</button>
            </div>
            <div className="log-list">
              {logs.map((log) => (
                <div key={log.id} className="log-item">
                  <div className="log-action">{log.details}</div>
                  <div className="log-meta">
                    {log.user_name} · {new Date(log.created_at).toLocaleString('ko-KR')}
                  </div>
                </div>
              ))}
              {logs.length === 0 && <div className="empty-state">이력이 없습니다.</div>}
            </div>
            {signatures.length > 0 && (
              <>
                <h4 style={{ marginTop: '1rem' }}>서명 이력</h4>
                <div className="log-list">
                  {signatures.map((sig) => (
                    <div key={sig.id} className="log-item">
                      <div className="log-action">{sig.user_name || sig.user_email} 서명 완료</div>
                      <div className="log-meta">
                        IP: {sig.ip_address} · {new Date(sig.signed_at).toLocaleString('ko-KR')}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Sidebar: Signature Canvas */}
        {showSignature && id && (
          <SignaturePanel
            documentId={id}
            signatureType={signatureType}
            onClose={() => setShowSignature(false)}
            onSign={handleSignComplete}
          />
        )}
      </div>
    </div>
  );
}

// 페이지 번호 오버레이
function PageNumbers() {
  const [pageCount, setPageCount] = useState(1);
  const PAGE_HEIGHT = 1123; // A4 높이 px

  useEffect(() => {
    const observe = () => {
      const el = document.querySelector('.editor-area');
      if (!el) return;
      const h = el.scrollHeight;
      setPageCount(Math.max(1, Math.ceil(h / PAGE_HEIGHT)));
    };

    observe();
    const observer = new MutationObserver(observe);
    const el = document.querySelector('.editor-area');
    if (el) observer.observe(el, { childList: true, subtree: true, characterData: true });

    const resizeObserver = new ResizeObserver(observe);
    if (el) resizeObserver.observe(el);

    return () => { observer.disconnect(); resizeObserver.disconnect(); };
  }, []);

  if (pageCount <= 1) return null;

  return (
    <>
      {Array.from({ length: pageCount }, (_, i) => (
        <div
          key={i}
          className="page-number-label"
          style={{ top: i * PAGE_HEIGHT + PAGE_HEIGHT - 30 }}
        >
          {i + 1} / {pageCount}
        </div>
      ))}
    </>
  );
}
