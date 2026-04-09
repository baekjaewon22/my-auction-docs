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
import type { Document, DocumentLog, Signature, ApprovalStep } from '../types';
import SignaturePanel, { hasSavedSignature, quickSign } from '../components/SignaturePanel';
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
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);
  const [showCancelRequest, setShowCancelRequest] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
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
    editorProps: {
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target as HTMLElement;
          if (!target || !target.closest('.tiptap')) return false;

          // 클릭 지점의 텍스트 노드 찾기
          const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
          if (!range) return false;

          const textNode = range.startContainer;
          if (textNode.nodeType !== 3) return false;
          const text = textNode.textContent || '';
          const offset = range.startOffset;

          // 클릭 위치 근처(±2)에서 ☐/☑ 찾기
          let idx = -1;
          for (let i = Math.max(0, offset - 2); i <= Math.min(text.length - 1, offset + 2); i++) {
            if (text[i] === '☐' || text[i] === '☑') { idx = i; break; }
          }
          if (idx === -1) return false;

          // ProseMirror pos 계산: DOM 텍스트 노드 → ProseMirror 위치
          const pmPos = view.posAtDOM(textNode, idx);
          if (pmPos < 0) return false;

          const toggled = text[idx] === '☐' ? '☑' : '☐';
          const tr = view.state.tr.replaceWith(
            pmPos, pmPos + 1,
            view.state.schema.text(toggled)
          );
          view.dispatch(tr); // 상태 동기화 → onUpdate → 자동저장

          event.preventDefault();
          return true;
        },
      },
    },
  });

  const isEditable = doc && (
    // draft/rejected: 본인만 (master 예외)
    ((doc.status === 'draft' || doc.status === 'rejected') && (doc.author_id === user?.id || user?.role === 'master')) ||
    // submitted: 관리자 이상만
    (doc.status === 'submitted' && ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || ''))
  );

  // 결재선에 내가 포함되어 있고 pending인 단계가 있으면 승인 가능, 또는 master/ceo/admin
  const myPendingStep = approvalSteps.find(s => s.approver_id === user?.id && s.status === 'pending');
  const prevAllApproved = myPendingStep
    ? approvalSteps.filter(s => s.step_order < myPendingStep.step_order).every(s => s.status === 'approved')
    : false;
  const canApprove = doc && doc.status === 'submitted' && (
    (myPendingStep && prevAllApproved) ||
    ['master', 'ceo', 'cc_ref'].includes(user?.role || '')
  );

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
      api.documents.steps(id).catch(() => ({ steps: [] })),
    ]).then(([docRes, logRes, sigRes, stepsRes]) => {
      const d = docRes.document;
      setDoc(d);
      setTitle(d.title);
      setLogs(logRes.logs);
      setSignatures(sigRes.signatures);
      setApprovalSteps(stepsRes.steps || []);
      if (editor) {
        editor.commands.setContent(d.content === '{}' ? '' : d.content);
        const canEdit =
          ((d.status === 'draft' || d.status === 'rejected') && (d.author_id === user?.id || user?.role === 'master')) ||
          (d.status === 'submitted' && ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || ''));
        editor.setEditable(canEdit);
      }
    }).catch((err) => { console.error('문서 로딩 실패:', err); navigate('/documents'); });
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
    // 승인 전 서명 필수 확인
    const alreadySigned = signatures.some(s => s.user_id === user?.id);
    if (!alreadySigned) {
      // 저장된 서명이 있으면 자동 서명 후 승인
      if (hasSavedSignature()) {
        try {
          await quickSign(id, 'approver', handleSignComplete);
        } catch {
          alert('서명 처리 중 오류가 발생했습니다.');
          return;
        }
      } else {
        alert('승인 전 결재란에서 서명을 먼저 완료해주세요.');
        return;
      }
    }
    const result = await api.documents.approve(id) as any;
    if (result.final) {
      alert('문서가 최종 승인되었습니다.');
    } else {
      alert('승인 완료. 다음 단계 결재자에게 전달됩니다.');
    }
    window.location.reload();
  };

  const handleReject = async () => {
    if (!id) return;
    await api.documents.reject(id, rejectReason);
    window.location.reload();
  };

  const handleCancelRequest = async () => {
    if (!id || !cancelReason.trim()) { alert('취소 사유를 입력하세요.'); return; }
    if (!confirm('이 문서의 취소를 신청하시겠습니까?')) return;
    try {
      await api.documents.cancelRequest(id, cancelReason.trim());
      alert('취소 신청이 완료되었습니다. 관리자 승인 후 취소됩니다.');
      window.location.reload();
    } catch (err: any) { alert(err.message); }
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

    // 동적 결재선: 작성자 + approval_steps
    const pdfSlots: { label: string; sig?: Signature }[] = [
      { label: '작성자', sig: signatures[0] },
    ];
    for (const step of approvalSteps) {
      const stepSig = signatures.find(s => s.user_id === step.approver_id && signatures.indexOf(s) >= 1);
      pdfSlots.push({ label: step.approver_name || `승인 ${step.step_order}`, sig: stepSig });
    }
    // 결재선 없으면 기존 고정 슬롯
    if (approvalSteps.length === 0) {
      pdfSlots.push({ label: '승인자', sig: signatures[1] });
    }

    const headerRow = document.createElement('tr');
    pdfSlots.forEach((slot) => {
      const th = document.createElement('th');
      th.style.cssText = 'border: 1px solid #999; padding: 4px 12px; background: #f5f5f5; font-size: 10px; width: 70px; text-align: center;';
      th.textContent = slot.label;
      headerRow.appendChild(th);
    });
    sigTable.appendChild(headerRow);

    const dataRow = document.createElement('tr');
    pdfSlots.forEach((slot) => {
      const td = document.createElement('td');
      td.style.cssText = 'border: 1px solid #999; padding: 4px; height: 50px; width: 70px; text-align: center; vertical-align: middle;';
      const sig = slot.sig;
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
  const handleApprovalSign = async (type: 'author' | 'approver') => {
    if (!id) return;
    // 저장된 서명이 있으면 패널 없이 즉시 서명
    if (hasSavedSignature()) {
      try {
        await quickSign(id, type, handleSignComplete);
      } catch (err: any) {
        alert(err.message || '서명 처리 중 오류가 발생했습니다.');
      }
      return;
    }
    // 저장된 서명이 없으면 패널 열기 (최초 서명 등록)
    setSignatureType(type);
    setShowSignature(true);
  };

  // 서명 완료 - 결재란에만 반영 (문서 본문은 건드리지 않음)
  const handleSignComplete = (_signatureData: string, _type: SignatureType) => {
    if (!id) return;
    api.signatures.getByDocument(id).then((res) => setSignatures(res.signatures));
    setShowSignature(false);
  };

  // 현재 문서 내용을 원본 템플릿에 덮어쓰기
  const handleSaveAsTemplate = async () => {
    if (!doc?.template_id || !editor) return;
    if (!confirm('현재 문서 내용으로 템플릿을 업데이트하시겠습니까?\n이후 이 템플릿으로 만드는 문서에 모두 적용됩니다.')) return;
    try {
      await api.templates.update(doc.template_id, { content: editor.getHTML() });
      alert('템플릿이 업데이트되었습니다.');
    } catch {
      alert('템플릿 업데이트에 실패했습니다.');
    }
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
          {isEditable && doc.template_id && user && ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role) && (
            <button className="btn btn-sm" onClick={handleSaveAsTemplate} title="현재 내용을 템플릿에 반영">템플릿 저장</button>
          )}

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

          {/* 취소 신청: 본인 문서 + 승인/제출 상태 + 아직 취소신청 안 한 경우 */}
          {doc && !doc.cancelled && !doc.cancel_requested && (doc.status === 'approved' || doc.status === 'submitted') && doc.author_id === user?.id && (
            <button className="btn btn-sm" style={{ color: '#d93025', borderColor: '#d93025' }} onClick={() => setShowCancelRequest(true)}>취소 신청</button>
          )}
        </div>
      </div>

      {/* Reject reason banner */}
      {doc.status === 'rejected' && doc.reject_reason && (
        <div className="alert alert-error">반려 사유: {doc.reject_reason}</div>
      )}

      {/* 취소 완료 배너 */}
      {doc.cancelled === 1 && (
        <div className="alert" style={{ background: '#f1f3f4', color: '#5f6368', borderColor: '#dadce0' }}>
          이 문서는 취소 처리되었습니다. {doc.cancel_reason && <>사유: {doc.cancel_reason}</>}
        </div>
      )}

      {/* 취소 신청 중 배너 */}
      {doc.cancel_requested === 1 && !doc.cancelled && (
        <div className="alert" style={{ background: '#fff8e1', color: '#e65100', borderColor: '#ffcc02' }}>
          취소 신청 중입니다. 사유: {doc.cancel_reason || '없음'}
        </div>
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

      {/* Cancel request modal */}
      {showCancelRequest && (
        <div className="modal-overlay" onClick={() => setShowCancelRequest(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>문서 취소 신청</h3>
            <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 12px' }}>
              관리자가 승인하면 이 문서는 취소 처리됩니다.
            </p>
            <div className="form-group">
              <label>취소 사유 *</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="취소 사유를 입력하세요"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCancelRequest(false)}>닫기</button>
              <button className="btn btn-danger" onClick={handleCancelRequest}>취소 신청</button>
            </div>
          </div>
        </div>
      )}

      <div className="editor-body">
        {/* ── 고정 결재란 (에디터 위) ── */}
        <ApprovalBar
          signatures={signatures}
          approvalSteps={approvalSteps}
          currentUserId={user?.id}
          currentUserRole={user?.role}
          docStatus={doc.status}
          authorName={doc.author_name}
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
                    {log.user_name} · {new Date(log.created_at + 'Z').toLocaleString('ko-KR')}
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
                        IP: {sig.ip_address} · {new Date(sig.signed_at + 'Z').toLocaleString('ko-KR')}
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

// 페이지 구분선 + 번호 오버레이
function PageNumbers() {
  const [pageCount, setPageCount] = useState(1);
  const PAGE_HEIGHT = 1123;

  useEffect(() => {
    const observe = () => {
      const el = document.querySelector('.editor-area');
      if (!el) return;
      setPageCount(Math.max(1, Math.ceil(el.scrollHeight / PAGE_HEIGHT)));
    };

    observe();
    const observer = new MutationObserver(observe);
    const resizeObserver = new ResizeObserver(observe);
    const el = document.querySelector('.editor-area');
    if (el) { observer.observe(el, { childList: true, subtree: true, characterData: true }); resizeObserver.observe(el); }
    return () => { observer.disconnect(); resizeObserver.disconnect(); };
  }, []);

  if (pageCount <= 1) return null;

  return (
    <>
      {Array.from({ length: pageCount - 1 }, (_, i) => {
        const y = (i + 1) * PAGE_HEIGHT;
        return (
          <div key={i}>
            <div className="page-break-line" style={{ top: y }} data-pages={`${i + 1}-${pageCount} / ${i + 2}-${pageCount}`} />
            <div className="page-gap" style={{ top: y - 1 }} />
          </div>
        );
      })}
    </>
  );
}
