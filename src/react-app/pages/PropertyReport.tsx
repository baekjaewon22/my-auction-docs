import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Signature, ApprovalStep } from '../types';
import SignaturePanel, { hasSavedSignature, quickSign } from '../components/SignaturePanel';
import type { SignatureType } from '../components/SignaturePanel';
import ApprovalBar from '../components/ApprovalBar';
import { FileDown, Save, ArrowLeft, Send, Printer } from 'lucide-react';

// 직인 사용 가능 역할
const STAMP_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'];

export default function PropertyReport() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const printRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [docId, setDocId] = useState(id || '');
  const [status, setStatus] = useState('draft');

  // 결재/서명
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);
  const [showSignPanel, setShowSignPanel] = useState(false);
  const [signType, setSignType] = useState<'author' | 'approver'>('author');

  const canUseStamp = STAMP_ROLES.includes(user?.role || '');

  // 편집 필드
  const [fields, setFields] = useState({
    court: '', caseNo: '', appraisalPrice: '', propertyType: '', propertyDesc: '',
    extinguish: '', priority: '', futile: '', special: '',
    unpaidAmount: '', mgmtBasis: '', unpaidPeriod: '',
    commissionRate: '', bidderName: '',
    clientName: '', clientSsn: '', clientPhone: '', clientEmail: '', clientAddr: '',
    staffName: user?.name || '', staffPhone: user?.phone || '',
    writeDate: '',
  });

  // KST 날짜
  useEffect(() => {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const d = now.getUTCDate();
    setFields(f => ({ ...f, writeDate: `${y}년 ${m}월 ${d}일`, staffName: user?.name || '', staffPhone: user?.phone || '' }));
  }, [user]);

  // 기존 문서 로드
  const loadDoc = async (docIdToLoad: string) => {
    try {
      const res = await api.documents.get(docIdToLoad);
      const doc = res.document;
      setStatus(doc.status);
      try {
        const saved = JSON.parse(doc.content);
        if (saved && typeof saved === 'object' && saved.court !== undefined) setFields(saved);
      } catch { /* */ }
      // 서명/결재선 로드
      const [sigRes, stepRes] = await Promise.all([
        api.signatures.getByDocument(docIdToLoad).catch(() => ({ signatures: [] })),
        api.documents.steps(docIdToLoad).catch(() => ({ steps: [] })),
      ]);
      setSignatures(sigRes.signatures || []);
      setApprovalSteps(stepRes.steps || []);
    } catch { /* */ }
  };

  useEffect(() => {
    if (id) loadDoc(id);
  }, [id]);

  // 서명 처리 — approverRole로 자동 판단
  const handleSignRequest = async (type: 'author' | 'approver', approverRole?: string) => {
    if (!docId) return;

    // CEO 결재란 → 자동으로 대표 직인
    if (canUseStamp && approverRole === 'ceo') {
      try {
        await api.signatures.sign(docId, '/LNCstemp.png');
        if (type === 'approver') {
          await api.documents.approve(docId);
        }
        await loadDoc(docId);
      } catch (err: any) { alert(err.message); }
      return;
    }

    // 그 외 → 본인 서명
    if (hasSavedSignature()) {
      try {
        await quickSign(docId, 'author', async () => {
          if (type === 'approver') {
            await api.documents.approve(docId);
          }
          await loadDoc(docId);
        });
      } catch (err: any) { alert(err.message); }
    } else {
      setSignType(type);
      setShowSignPanel(true);
    }
  };

  const handleSignComplete = async (_sigData: string, _type: SignatureType) => {
    if (!docId) return;
    try {
      if (signType === 'approver') {
        await api.documents.approve(docId);
      }
      setShowSignPanel(false);
      await loadDoc(docId);
    } catch (err: any) { alert(err.message); }
  };

  const updateField = (key: string, value: string) => setFields(f => ({ ...f, [key]: value }));

  // 저장
  const handleSave = async () => {
    setSaving(true);
    try {
      if (docId) {
        await api.documents.update(docId, { content: JSON.stringify(fields) });
      } else {
        const res = await api.documents.create({ title: '물건분석보고서', content: JSON.stringify(fields), template_id: 'tpl-work-008' });
        if (res.document?.id) {
          setDocId(res.document.id);
          window.history.replaceState(null, '', `/property-report/${res.document.id}`);
        }
      }
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  // 제출 (서명 필수)
  const handleSubmit = async () => {
    if (!mySigned) {
      alert('결재란에서 작성자 서명을 먼저 완료하세요.');
      return;
    }
    if (!docId) { await handleSave(); }
    if (!confirm('물건분석보고서를 제출하시겠습니까?')) return;
    try {
      if (!docId) return;
      await api.documents.update(docId, { content: JSON.stringify(fields) });
      await api.documents.submit(docId);
      setStatus('submitted');
      alert('제출되었습니다.');
      await loadDoc(docId);
    } catch (err: any) { alert(err.message); }
  };

  // PDF 출력
  const handlePdf = async () => {
    const el = printRef.current;
    if (!el) return;
    const pages = el.querySelectorAll('.pr-page') as NodeListOf<HTMLElement>;
    if (pages.length === 0) { alert('PDF로 변환할 페이지가 없습니다.'); return; }

    try {
      const { default: jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        // 안정적인 캔버스 생성: 고정 너비 기반
        const page = pages[i];
        const origWidth = page.style.width;
        const origHeight = page.style.height;
        page.style.width = '794px'; // A4 @96dpi
        page.style.height = '1123px';

        const canvas = await html2canvas(page, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 794,
          windowHeight: 1123,
          backgroundColor: '#ffffff',
        });

        page.style.width = origWidth;
        page.style.height = origHeight;

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      }
      pdf.save('물건분석보고서.pdf');
    } catch (err: any) {
      console.error('PDF 생성 오류:', err);
      alert('PDF 생성에 실패했습니다: ' + (err.message || '알 수 없는 오류'));
    }
  };

  // 프린트 — iframe 방식 (페이지 분리 정확)
  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>
      @page { margin: 0; size: A4; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { width: 210mm; font-family: '맑은 고딕','Malgun Gothic',sans-serif; }
      .pr-page {
        width: 210mm; height: 297mm;
        page-break-after: always;
        overflow: hidden;
        position: relative;
      }
      .pr-page:last-child { page-break-after: auto; }
      img { max-width: 100%; }
      .pr-field { border-bottom: 1px solid #aaa; padding: 0 4px; display: inline-block; min-width: 80px; }
    </style></head><body>${el.innerHTML}</body></html>`);
    doc.close();

    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }, 300);
    };
    // fallback: onload 안 발생 시
    setTimeout(() => {
      try { iframe.contentWindow?.print(); } catch {}
      setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 1000);
    }, 1500);
  };

  const isEditable = status === 'draft' || status === 'rejected';
  const page1Ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [overflowWarn, setOverflowWarn] = useState(false);
  const [mobileScale, setMobileScale] = useState(1);
  const mySigned = signatures.some(s => s.user_id === user?.id);

  // 모바일 스케일 자동 계산
  useEffect(() => {
    const calcScale = () => {
      const vw = window.innerWidth;
      const a4w = 794; // 210mm in px
      if (vw < a4w + 40) {
        setMobileScale(Math.max((vw - 16) / a4w, 0.3));
      } else {
        setMobileScale(1);
      }
    };
    calcScale();
    window.addEventListener('resize', calcScale);
    return () => window.removeEventListener('resize', calcScale);
  }, []);

  // 1페이지 높이 초과 감지
  const checkOverflow = () => {
    const el = page1Ref.current;
    if (!el) return;
    const isOver = el.scrollHeight > el.clientHeight + 2;
    setOverflowWarn(isOver);
  };

  // 붙여넣기 시 서식 제거 (plain text only)
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  // Tab으로 다음 입력칸 이동
  const focusNext = (current: HTMLElement, reverse?: boolean) => {
    const all = Array.from(printRef.current?.querySelectorAll('[contenteditable="true"]') || []) as HTMLElement[];
    const idx = all.indexOf(current);
    const next = reverse ? all[idx - 1] : all[idx + 1];
    if (next) { next.focus(); }
  };

  // 편집 가능한 인풋
  const F = ({ k, w, ph }: { k: string; w?: string; ph?: string }) => {
    const val = (fields as any)[k];
    return (
      <span
        contentEditable={isEditable}
        suppressContentEditableWarning
        className="pr-field"
        tabIndex={0}
        style={{ minWidth: w || '80px', display: 'inline-block', borderBottom: '1px solid #aaa', padding: '0 4px', outline: 'none', background: isEditable ? '#fffde7' : 'transparent' }}
        onPaste={handlePaste}
        onFocus={(e) => {
          if (!val && ph) e.currentTarget.textContent = '';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const text = e.currentTarget.textContent || '';
            updateField(k, text);
            focusNext(e.currentTarget as HTMLElement, e.shiftKey);
          }
        }}
        onInput={() => checkOverflow()}
        onBlur={(e) => {
          const text = e.currentTarget.textContent || '';
          updateField(k, text);
          checkOverflow();
        }}
        dangerouslySetInnerHTML={{ __html: val || (ph ? `<span style="color:#ccc">${ph}</span>` : '&nbsp;') }}
      />
    );
  };

  return (
    <div className="page" style={{ background: '#f5f5f5', minHeight: '100vh' }}>
      {/* 툴바 - 모바일 반응형 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid #e8eaed', padding: '6px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => navigate('/documents')}><ArrowLeft size={14} /></button>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1a2744' }}>물건분석보고서</span>
          {status !== 'draft' && <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 6, background: status === 'submitted' ? '#e8f0fe' : status === 'approved' ? '#e8f5e9' : '#fff3e0', color: status === 'submitted' ? '#1a73e8' : status === 'approved' ? '#188038' : '#e65100' }}>{status === 'submitted' ? '제출' : status === 'approved' ? '승인' : status === 'rejected' ? '반려' : status}</span>}
          <div style={{ flex: 1 }} />
          {saving && <span style={{ fontSize: '0.7rem', color: '#9aa0a6' }}>저장중...</span>}
          {isEditable && <button className="btn btn-sm btn-primary" onClick={handleSave}><Save size={14} /></button>}
          {isEditable && (
            <button className="btn btn-sm" style={{ background: '#188038', color: '#fff', opacity: mySigned ? 1 : 0.5 }} onClick={handleSubmit}>
              <Send size={14} />
            </button>
          )}
          <button className="btn btn-sm" onClick={handlePdf} title="PDF 저장"><FileDown size={14} /></button>
          <button className="btn btn-sm" onClick={handlePrint} title="프린트"><Printer size={14} /></button>
        </div>
        {overflowWarn && <div style={{ fontSize: '0.7rem', color: '#d93025', fontWeight: 600, background: '#fce4ec', padding: '3px 8px', borderRadius: 6, marginTop: 4, textAlign: 'center' }}>1페이지 초과! 내용을 줄여주세요.</div>}
      </div>

      {/* 결재란 */}
      {docId && (
        <div style={{ maxWidth: '210mm', margin: '0 auto', padding: '8px 12px', background: '#fff', borderBottom: '1px solid #e8eaed', overflowX: 'auto' }}>
          <ApprovalBar
            signatures={signatures}
            approvalSteps={approvalSteps}
            currentUserId={user?.id}
            currentUserRole={user?.role}
            docStatus={status}
            authorName={user?.name}
            onSign={handleSignRequest}
          />
        </div>
      )}

      {/* 서명 패널 */}
      {showSignPanel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 400, width: '90%' }}>
            <SignaturePanel documentId={docId} signatureType={signType} onSign={handleSignComplete} onClose={() => setShowSignPanel(false)} />
          </div>
        </div>
      )}

      {/* 보고서 본문 - 모바일 스케일 대응 */}
      <div ref={wrapRef} className="pr-scroll-wrap" style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', overflow: 'hidden' }}>
        <div style={{ transform: `scale(${mobileScale})`, transformOrigin: 'top center', width: '210mm', transition: 'transform 0.2s' }}>
        <div ref={printRef} className="pr-print-area" style={{ width: '210mm', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' }}>

          {/* ===== 1페이지 (컴팩트) ===== */}
          <div ref={page1Ref} className="pr-page" style={{ width: '210mm', height: '297mm', padding: '10mm 16mm 10mm', position: 'relative', overflow: 'hidden', pageBreakAfter: 'always', boxSizing: 'border-box', fontFamily: "'맑은 고딕','Malgun Gothic',sans-serif", fontSize: '9pt', color: '#1a1a1a', lineHeight: '1.45' }}>
            {/* 워터마크 */}
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 0, opacity: 0.04 }}>
              <img src="/logo2.png" style={{ width: '150mm', objectFit: 'contain' }} />
            </div>

            {/* 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, borderBottom: '3px solid #1a2744', paddingBottom: 6, position: 'relative', zIndex: 1 }}>
              <div>
                <div style={{ fontSize: '7pt', color: '#8a9ab5', letterSpacing: 2, marginBottom: 1 }}>PROPERTY ANALYSIS REPORT</div>
                <div style={{ fontSize: '18pt', fontWeight: 800, color: '#1a2744', letterSpacing: 5 }}>물건분석 보고서</div>
              </div>
              <table style={{ borderCollapse: 'collapse', fontSize: '7.5pt', textAlign: 'center' }}>
                {(() => {
                  const headers = ['담당자'];
                  if (approvalSteps.length > 0) {
                    approvalSteps.forEach(s => headers.push((s as any).approver_title || s.approver_name || '승인자'));
                  } else {
                    headers.push('결재자');
                  }
                  const slots: (Signature | null)[] = Array(headers.length).fill(null);
                  if (signatures.length > 0) slots[0] = signatures[0];
                  const usedSigIds = new Set<string>();
                  if (signatures.length > 0) usedSigIds.add(signatures[0].id || '');
                  approvalSteps.forEach((step, idx) => {
                    if (idx + 1 < headers.length) {
                      // 1) 정확히 매칭
                      let sig = signatures.find(s => s.user_id === step.approver_id && signatures.indexOf(s) >= 1 && !usedSigIds.has(s.id || ''));
                      // 2) proxy 매칭
                      if (!sig && step.status === 'approved' && (step as any).comment?.startsWith('proxy:')) {
                        const proxyId = (step as any).comment.replace('proxy:', '');
                        sig = signatures.find(s => s.user_id === proxyId && signatures.indexOf(s) >= 1 && !usedSigIds.has(s.id || ''));
                      }
                      // 3) CEO step → 직인 서명 매칭 (대리 승인)
                      if (!sig && step.status === 'approved' && (step as any).approver_role === 'ceo') {
                        sig = signatures.find(s => s.signature_data === '/LNCstemp.png' && !usedSigIds.has(s.id || ''));
                      }
                      // 4) 승인된 step인데 매칭 안 되면 → 남은 서명 중 순서대로
                      if (!sig && step.status === 'approved') {
                        sig = signatures.find(s => signatures.indexOf(s) >= 1 && !usedSigIds.has(s.id || ''));
                      }
                      if (sig) { slots[idx + 1] = sig; usedSigIds.add(sig.id || ''); }
                      else if (step.status === 'approved') slots[idx + 1] = { signature_data: '', signed_at: step.signed_at || '', user_name: step.approver_name } as any;
                    }
                  });
                  return (
                    <>
                      <thead><tr>
                        {headers.map((h, i) => (
                          <th key={i} style={{ border: '1px solid #c5cdd8', padding: '2px 10px', background: 'linear-gradient(180deg, #f8f9fb 0%, #eef1f5 100%)', fontWeight: 700, color: '#1a2744', fontSize: '7pt' }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        <tr>
                          {slots.map((sig, i) => (
                            <td key={i} style={{ border: '1px solid #c5cdd8', padding: '1px 3px', height: 30, minWidth: 48, textAlign: 'center', verticalAlign: 'middle' }}>
                              {sig?.signature_data ? <img src={sig.signature_data} style={{ height: 22, objectFit: 'contain' }} /> : '\u00A0'}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          {slots.map((sig, i) => (
                            <td key={i} style={{ border: '1px solid #c5cdd8', padding: '0px 3px', fontSize: '6pt', color: '#8a9ab5', textAlign: 'center' }}>
                              {sig?.signed_at ? new Date(sig.signed_at).toLocaleDateString('ko-KR') : '\u00A0'}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </>
                  );
                })()}
              </table>
            </div>

            {/* 권리분석의 대상 */}
            <div style={{ fontSize: '10pt', fontWeight: 800, color: '#1a2744', borderLeft: '3px solid #1a2744', paddingLeft: 8, margin: '6px 0 4px', letterSpacing: 1, position: 'relative', zIndex: 1 }}>권리분석의 대상</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4, fontSize: '8.5pt', position: 'relative', zIndex: 1 }}>
              <tbody>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 6px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', width: 80, color: '#1a2744', fontSize: '8.5pt' }}>법 원</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 6px' }}><F k="court" w="180px" ph="법원명" /></td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 6px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', width: 80, color: '#1a2744', fontSize: '8.5pt' }}>사건번호</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 6px' }}><F k="caseNo" w="120px" ph="사건번호" /></td>
                </tr>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 6px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', width: 80, color: '#1a2744', fontSize: '8.5pt' }}>감 정 가</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 6px' }}><F k="appraisalPrice" w="120px" ph="감정가" /></td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 6px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', width: 80, color: '#1a2744', fontSize: '8.5pt' }}>물건종류</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 6px' }}><F k="propertyType" w="120px" ph="물건종류" /></td>
                </tr>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 6px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', width: 80, color: '#1a2744', fontSize: '8.5pt' }}>대상물표시</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 6px' }} colSpan={3}><F k="propertyDesc" w="100%" ph="대상물 표시" /></td>
                </tr>
              </tbody>
            </table>

            {/* 권리분석 내용 */}
            <div style={{ fontSize: '10pt', fontWeight: 800, color: '#1a2744', borderLeft: '3px solid #1a2744', paddingLeft: 8, margin: '6px 0 4px', letterSpacing: 1 }}>권리분석 내용</div>
            <div style={{ fontSize: '8.5pt', lineHeight: 1.5, padding: '0 2px' }}>
              <div style={{ marginBottom: 2 }}>1. <b style={{ color: '#1a2744' }}>말소기준 및 등기부상 소멸 불가 사항</b>
                <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', background: isEditable ? '#fffde7' : 'transparent', lineHeight: 1.45, outline: 'none', whiteSpace: 'pre-wrap', fontSize: '8.5pt', minHeight: '1.3em', color: '#1a1a1a' }}
                  contentEditable={isEditable} suppressContentEditableWarning tabIndex={0}
                  onPaste={handlePaste}
                  onFocus={(e) => { if (!fields.extinguish || fields.extinguish.includes('color:#ccc')) e.currentTarget.innerHTML = ''; }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') { e.preventDefault(); updateField('extinguish', e.currentTarget.innerHTML || ''); focusNext(e.currentTarget as HTMLElement, e.shiftKey); }
                    else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); setTimeout(checkOverflow, 10); }
                  }}
                  onInput={() => checkOverflow()}
                  onBlur={(e) => { updateField('extinguish', e.currentTarget.innerHTML || ''); checkOverflow(); }}
                  dangerouslySetInnerHTML={{ __html: fields.extinguish && !fields.extinguish.includes('color:#ccc') ? fields.extinguish : '<span style="color:#ccc">내용 입력</span>' }} />
              </div>
              <div style={{ marginBottom: 2 }}>2. <b style={{ color: '#1a2744' }}>임차권리 인수사항</b>
                <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', background: isEditable ? '#fffde7' : 'transparent', lineHeight: 1.45, outline: 'none', whiteSpace: 'pre-wrap', fontSize: '8.5pt', minHeight: '1.3em', color: '#1a1a1a' }}
                  contentEditable={isEditable} suppressContentEditableWarning tabIndex={0}
                  onPaste={handlePaste}
                  onFocus={(e) => { if (!fields.priority || fields.priority.includes('color:#ccc')) e.currentTarget.innerHTML = ''; }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') { e.preventDefault(); updateField('priority', e.currentTarget.innerHTML || ''); focusNext(e.currentTarget as HTMLElement, e.shiftKey); }
                    else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); setTimeout(checkOverflow, 10); }
                  }}
                  onInput={() => checkOverflow()}
                  onBlur={(e) => { updateField('priority', e.currentTarget.innerHTML || ''); checkOverflow(); }}
                  dangerouslySetInnerHTML={{ __html: fields.priority && !fields.priority.includes('color:#ccc') ? fields.priority : '<span style="color:#ccc">내용 입력</span>' }} />
              </div>
              <div style={{ marginBottom: 2 }}>3. <b style={{ color: '#1a2744' }}>무잉여 / 취하 가능성</b>
                <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', background: isEditable ? '#fffde7' : 'transparent', lineHeight: 1.45, outline: 'none', whiteSpace: 'pre-wrap', fontSize: '8.5pt', minHeight: '1.3em', color: '#1a1a1a' }}
                  contentEditable={isEditable} suppressContentEditableWarning tabIndex={0}
                  onPaste={handlePaste}
                  onFocus={(e) => { if (!fields.futile || fields.futile.includes('color:#ccc')) e.currentTarget.innerHTML = ''; }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') { e.preventDefault(); updateField('futile', e.currentTarget.innerHTML || ''); focusNext(e.currentTarget as HTMLElement, e.shiftKey); }
                    else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); setTimeout(checkOverflow, 10); }
                  }}
                  onInput={() => checkOverflow()}
                  onBlur={(e) => { updateField('futile', e.currentTarget.innerHTML || ''); checkOverflow(); }}
                  dangerouslySetInnerHTML={{ __html: fields.futile && !fields.futile.includes('color:#ccc') ? fields.futile : '<span style="color:#ccc">내용 입력</span>' }} />
              </div>
              <div style={{ marginBottom: 2 }}>4. <b style={{ color: '#1a2744' }}>특이사항</b>
                <div style={{ minHeight: '8em', borderBottom: '1px solid #aaa', padding: '2px 4px', background: isEditable ? '#fffde7' : 'transparent', lineHeight: 1.45, outline: 'none', whiteSpace: 'pre-wrap', fontSize: '8.5pt', color: '#1a1a1a' }}
                  contentEditable={isEditable} suppressContentEditableWarning tabIndex={0}
                  onPaste={handlePaste}
                  onFocus={(e) => { if (!fields.special || fields.special.includes('color:#ccc')) e.currentTarget.innerHTML = ''; }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') { e.preventDefault(); updateField('special', e.currentTarget.innerHTML || ''); focusNext(e.currentTarget as HTMLElement, e.shiftKey); return; }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      document.execCommand('insertLineBreak');
                      setTimeout(checkOverflow, 10);
                    }
                  }}
                  onInput={() => checkOverflow()}
                  onBlur={(e) => {
                    // innerHTML로 저장해서 <br> 줄바꿈 보존
                    const html = e.currentTarget.innerHTML || '';
                    updateField('special', html);
                    checkOverflow();
                  }}
                  dangerouslySetInnerHTML={{ __html: fields.special && !fields.special.includes('color:#ccc') ? fields.special : '<span style="color:#ccc">내용 입력</span>' }} />
              </div>
              <p style={{ fontSize: '7.5pt', color: '#c0392b', marginTop: 2 }}>* 경매물건 분석 사항은 컨설팅 브리핑자료시 참조</p>
            </div>

            {/* 컨설팅 계약조건 */}
            <div style={{ fontSize: '10pt', fontWeight: 800, color: '#1a2744', borderLeft: '3px solid #1a2744', paddingLeft: 8, margin: '6px 0 4px', letterSpacing: 1 }}>컨설팅 계약조건</div>
            <div style={{ border: '1.5px solid #c5cdd8', borderRadius: 3, padding: '6px 10px', fontSize: '8.5pt', lineHeight: 1.45, background: '#fafbfc' }}>
              <div style={{ marginBottom: 2 }}>1. 상기 컨설팅에 대한 낙찰수수료는 <F k="commissionRate" w="80px" ph="" /> (부가세별도)로 한다.</div>
              <div style={{ marginBottom: 2 }}>2. 명도수수료 조건은 [정액제 / 실비제]로 한다.
                <div style={{ paddingLeft: '1em', fontSize: '8pt', lineHeight: 1.4, color: '#333' }}>
                  <b style={{ color: '#1a2744' }}>정액제</b> : 회사에 필요한 명도비를 모두 지급하고 명도에 관한 비용은 을의 법률 사무소가 부담한다.<br />
                  <b style={{ color: '#1a2744' }}>실비제</b> : 법률 사무소 수수료는 주거용 최대 150만원, 그 외 기타물건 최대 300만원을 초과하지 않으며 명도 관련 제비용은 발생시마다 의뢰인이 지급하기로 한다.
                </div>
              </div>
              <div style={{ marginBottom: 2 }}>3. 낙찰자 명의는 <F k="bidderName" w="80px" ph="명의자" />(으)로 하고 약관에 따른다.</div>
              <div>4. 수수료는 당일 지급하기로 한다. <span style={{ fontSize: '7.5pt', color: '#1a2744', fontWeight: 600 }}>신한은행 100-026-996624 (주)엘앤씨부동산중개법인</span></div>
            </div>

            {/* 서명 테이블 */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: '8pt' }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #eef1f5 0%, #e4e8ee 100%)', textAlign: 'center', fontWeight: 800, width: 36, fontSize: '7.5pt', color: '#1a2744' }} rowSpan={3}>(甲)<br />의뢰인</td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', width: 56, fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>성 명</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}><F k="clientName" w="90px" ph="성명" /></td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', width: 56, fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>주민번호</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}><F k="clientSsn" w="90px" ph="" /></td>
                  <td style={{ border: '1px solid #c5cdd8', padding: '2px', width: 44, textAlign: 'center', verticalAlign: 'middle', fontSize: '7pt', color: '#bbb', background: '#fcfcfd' }} rowSpan={3}>(인)</td>
                </tr>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>전화번호</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}><F k="clientPhone" w="90px" ph="" /></td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>이메일</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}><F k="clientEmail" w="90px" ph="" /></td>
                </tr>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>주 소</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }} colSpan={3}><F k="clientAddr" w="100%" ph="" /></td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #eef1f5 0%, #e4e8ee 100%)', textAlign: 'center', fontWeight: 800, width: 36, fontSize: '7pt', color: '#1a2744' }} rowSpan={3}>(乙)<br />마이옥션<br />㈜엘앤씨</td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>상 호</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>㈜엘앤씨부동산중개법인</td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>전화번호</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>1544-6542</td>
                  <td style={{ border: '1px solid #c5cdd8', padding: '1px', width: 48, textAlign: 'center', verticalAlign: 'middle', background: '#fcfcfd' }} rowSpan={3}>
                    <img src="/LNCstemp.png" style={{ width: 42, height: 42, objectFit: 'contain' }} />
                  </td>
                </tr>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt', whiteSpace: 'nowrap' }}>사업자번호</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>127-86-29704</td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>홈페이지</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>www.my-auction.co.kr</td>
                </tr>
                <tr>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>담 당 자</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.staffName}</td>
                  <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: 'linear-gradient(180deg, #f8f9fb 0%, #edf0f4 100%)', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>연락처</th>
                  <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.staffPhone}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: 5, fontSize: '8pt', color: '#333', padding: '4px 0', borderTop: '1.5px solid #c5cdd8' }}>☐ 본인은 개인정보 수집·이용에 동의합니다. (뒷면 개인정보 수집·이용 동의 내용 참조)</div>
          </div>

          {/* ===== 2페이지 ===== */}
          <div className="pr-page" style={{ width: '210mm', height: '297mm', padding: '12mm 15mm 12mm', position: 'relative', overflow: 'hidden', boxSizing: 'border-box', fontFamily: "'맑은 고딕','Malgun Gothic',sans-serif", fontSize: '10pt', color: '#1a1a1a', lineHeight: 1.55, display: 'flex', flexDirection: 'column' }}>
            {/* 워터마크 - 로고 이미지 */}
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 0, opacity: 0.04 }}>
              <img src="/logo.png" style={{ width: '160mm', objectFit: 'contain' }} />
            </div>

            <div style={{ textAlign: 'center', marginBottom: 10, borderBottom: '3px solid #1a2744', paddingBottom: 8, position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: '7pt', color: '#8a9ab5', letterSpacing: 2, marginBottom: 2 }}>CONSULTING CONTRACT TERMS</div>
              <h2 style={{ fontSize: '15pt', fontWeight: 800, color: '#1a2744', letterSpacing: 5, margin: 0 }}>컨설팅 계약약관</h2>
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: '7.5pt', lineHeight: 1.48, color: '#2a2a2a', position: 'relative', zIndex: 1, flex: 1 }}>
              {/* 좌 */}
              <div style={{ flex: 1 }}>
                {[
                  { t: '제 1조 [목적]', c: '이 약관은 전속 컨설팅 계약에 관하여 컨설팅 의뢰고객(이하 갑)과 컨설팅 수임법인 ㈜엘앤씨부동산중개법인(이하 을) 상호가 계약 이행사항을 명시함을 목적으로 한다.' },
                  { t: '제 2조 [적용범위]', c: '갑이 을에게 의뢰한 대상물의 컨설팅과 관련된 모든 진행사항에 적용된다.' },
                  { t: '제 3조 [용어의 정리]', c: '(1) 컨설팅이라 함은 대상물 부동산의 권리의 하자여부, 현황 분석, 가치 분석 등 대상 부동산의 취득에 관련된 사항을 조언 등을 하는 것을 일으로 하는 행위를 말한다.\n(2) 전속 컨설팅 계약이라 함은 컨설팅 대상물의 이중(二重)으로 전이외에 타인에게 위임할 수 없다는 것이다.\n(3) 컨설팅 의뢰고객이라 함은 대상 경매, 공매 부동산 등에 대하여 을에게 컨설팅을 의뢰하는 자를 말한다.\n(4) 컨설팅 수임법인이라 함은 관할 관청에 등록하고 컨설팅업을 수행하는 법인을 말한다.' },
                  { t: '제 4조 [약관 명시, 설명, 교부]', c: '(1) 을은 이 약관을 영업장에 비치하고 갑은 영업시간 중 언제든지 이를 열독하거나 그 교부를 요청할 수 있다.\n(2) 을은 계약체결 전에 이 약관 중요내용을 갑이 이해할 수 있도록 설명하고 약관을 교부한다.' },
                  { t: '제 5조 [계약의 성립]', c: '(1) 을이 약관의 내용을 설명하고 갑이 본 계약서에 서명 또는 인함으로써 계약이 성립한다.\n(2) 계약기간 중 계약내용의 변경은 당사자 상호간 서면합의를 통해서만 변경될 수 있으며, 서명 또는 인한 문서를 본 계약서 말미에 첨부한다.' },
                  { t: '제 6조 [필수 기재사항]', c: '컨설팅 계약서 및 물건분석 보고서에는 다음의 사항을 반드시 기재해야 하며, 기재되어 있지 않은 사항은 을의 법적 책임이 없다.\n  (1) 갑과 을의 성명 또는 상호, 주소, 전화번호, 주민등록번호 또는 사업자등록번호\n  (2) 컨설팅대상 부동산의 물건종류 및 사건번호\n  (3) 물건분석 보고서의 작성 책임 및 보장사항, 인수되는 사항 등' },
                  { t: '제 7조 [컨설팅 의무]', c: '(1) 갑과 을은 신뢰를 바탕으로 부동산 컨설팅 계약에 대하여 선의 성실과 정의로 컨설팅 의무를 이행하여 계약내용을 이행해야 한다.\n(2) 갑과 을은 부동산 컨설팅 의무의 수행에 따른 진행사항을 상호 알림할 수 있다.' },
                ].map((a, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '8pt', fontWeight: 800, color: '#1a2744', margin: '5px 0 1px', borderLeft: '2.5px solid #1a2744', paddingLeft: 5, letterSpacing: 0.3 }}>{a.t}</div>
                    {a.c.split('\n').map((l, j) => <p key={j} style={{ marginBottom: 1, textIndent: l.startsWith('  ') ? 0 : '0.7em', paddingLeft: l.startsWith('  ') ? '1.2em' : 0 }}>{l.trim()}</p>)}
                  </div>
                ))}
              </div>
              {/* 우 */}
              <div style={{ flex: 1 }}>
                {[
                  { t: '제 8조 [부동산 인도]', c: '대상물 부동산의 인도에 필요한 절차는 갑은 을의 법률 사무소가 진행하며, 을은 원활한 인도 처리를 위하여 갑의 요청시 인도완료시까지 최선을 다해 협력한다.' },
                  { t: '제 9조 [비용부담]', c: '취득에 따른 세금(취득세, 등록세 등) 및 등기이전비, 체납관리비, 이사 교체비를 포함한 각종 공과금은 실비제, 정액제 여부에 상관없이 갑의 부담으로 한다.\n(1) 정액제 진행시 갑의 비용부담 - 법원준비 청구내역 : 없음\n(2) 실비제 진행시 갑의 비용부담\n  - 법원준비(인지, 송달료, 출장비 등) / 법원준비(인도명령, 차분, 기타 법원비용)\n  - 가문비용(개처분, 계고, 인도진행 등) / 10~20만원(통상 1~3회)\n  - 이사비 준비, 이사합의비 / 합의금액(고객 필요시 진행)\n  - 인도진행비용(신청, 진행 등) / 법원준비(법원 진행규정에 따름)' },
                  { t: '제 10조 [수수료의 청구]', c: '(1) 수수료의 청구는 계약서에 정한 범위 내에서만 청구한다.\n(2) 갑이 을에게 특별히 의뢰한 경우 출장비는 갑의 부담으로 한다.\n(3) 을의 비용청구금액은 지체없이 지급해야 하며, 지방 출장비는 미리 합의하여야 한다.\n(4) 을이 이 계약에 정한 비용 또는 수수료의 지급을 보장하기 위해 갑에게 필요한 조치를 요구할 수 있다.\n(5) 을은 컨설팅 개시 전 갑이 사전에 알 수 있도록 대상물 취득에 소요되는 부대비용의 항목과 금액을 통지해야 한다.' },
                  { t: '제 11조 [해지와 환불]', c: '(1) 을의 귀책사유 또는 하자만으로 컨설팅 진행이 원활하지 못할 경우 을은 계약금 전액을 환불해야 한다.\n(2) 수수료 지급 이후 갑이 해지를 요구한 경우 수수료를 포기하고 해지를 요구한 것으로 을은 환불하지 않는다. 단, 을이 해지를 요구할 때에는 갑에게 수수료 전액을 지급해야 한다.' },
                  { t: '제 12조 [계약서의 교부]', c: '계약내용을 명시하기 위해 갑과 을은 본 계약서는 2부를 작성하여 상호가 이상이 없음을 확인하고 서명 또는 인하여 각각 보관한다.' },
                  { t: '제 13조 [관할 법원]', c: '본 계약에 관하여 갑과 을 상호간 소송의 필요가 있을 경우 을의 영업점 소재지의 지방법원을 관할 법원으로 하기로 한다.' },
                ].map((a, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '8pt', fontWeight: 800, color: '#1a2744', margin: '5px 0 1px', borderLeft: '2.5px solid #1a2744', paddingLeft: 5, letterSpacing: 0.3 }}>{a.t}</div>
                    {a.c.split('\n').map((l, j) => <p key={j} style={{ marginBottom: 1, textIndent: l.startsWith('  ') ? 0 : '0.7em', paddingLeft: l.startsWith('  ') ? '1.2em' : 0 }}>{l.trim()}</p>)}
                  </div>
                ))}
              </div>
            </div>

            {/* 개인정보 동의 */}
            <div style={{ border: '1.5px solid #1a2744', borderRadius: 4, padding: '8px 12px', marginTop: 8, fontSize: '7.5pt', lineHeight: 1.42, position: 'relative', zIndex: 1 }}>
              <h4 style={{ fontSize: '9pt', fontWeight: 700, color: '#1a2744', marginBottom: 3, textAlign: 'center', letterSpacing: 2 }}>개인정보 수집·이용 동의</h4>
              <p>㈜엘앤씨부동산중개법인(이하 "회사")은 컨설팅 계약 체결 및 이행을 위하여 아래와 같이 개인정보를 수집·이용합니다.</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', margin: '3px 0', fontSize: '7.5pt' }}>
                <thead><tr>
                  <th style={{ border: '1px solid #bcc5d0', padding: '2px 5px', textAlign: 'center', background: '#f0f3f7', fontWeight: 600, color: '#3a4a5c' }}>수집 항목</th>
                  <th style={{ border: '1px solid #bcc5d0', padding: '2px 5px', textAlign: 'center', background: '#f0f3f7', fontWeight: 600, color: '#3a4a5c' }}>수집·이용 목적</th>
                  <th style={{ border: '1px solid #bcc5d0', padding: '2px 5px', textAlign: 'center', background: '#f0f3f7', fontWeight: 600, color: '#3a4a5c' }}>보유·이용 기간</th>
                </tr></thead>
                <tbody><tr>
                  <td style={{ border: '1px solid #bcc5d0', padding: '2px 5px', textAlign: 'center' }}>성명, 주민등록번호, 전화번호, 이메일, 주소</td>
                  <td style={{ border: '1px solid #bcc5d0', padding: '2px 5px', textAlign: 'center' }}>컨설팅 계약 체결·이행, 낙찰 대리, 명도 절차 진행, 수수료 청구</td>
                  <td style={{ border: '1px solid #bcc5d0', padding: '2px 5px', textAlign: 'center' }}>계약 종료 후 5년</td>
                </tr></tbody>
              </table>
              <p>※ 개인정보 수집·이용에 대한 동의를 거부할 권리가 있으며, 동의 거부 시 컨설팅 계약 체결이 제한될 수 있습니다.</p>
              <div style={{ marginTop: 4, fontSize: '8pt', fontWeight: 600 }}>☐ 위 개인정보 수집·이용에 동의합니다.</div>
              <div style={{ marginTop: 3, textAlign: 'right', fontSize: '8pt' }}>{fields.writeDate} &nbsp;&nbsp; 의뢰인(갑): __________________ &nbsp; (서명) _______________</div>
            </div>

            {/* 푸터 */}
            <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7pt', color: '#8a9ab5', borderTop: '1.5px solid #c5cdd8', position: 'relative', zIndex: 1 }}>
              <img src="/logo.png" alt="MY-AUCTION" style={{ height: 42, objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', lineHeight: 1.35 }}>
                ㈜엘앤씨부동산중개법인 127-86-29704 &nbsp;|&nbsp; 경기도 의정부시 녹양로 41 풍전빌딩 2층<br />
                T. 1544-6542 &nbsp; F. 031-826-8923 &nbsp;|&nbsp; www.my-auction.co.kr
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
