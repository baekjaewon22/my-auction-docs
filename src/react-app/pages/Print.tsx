// 서버 Puppeteer가 navigate 하는 인쇄 전용 페이지
// - printToken으로 인증 없이 문서 데이터 fetch
// - 일반 문서: tiptap HTML 렌더
// - 물건분석보고서: JSON → PropertyReport 전용 레이아웃으로 렌더
// - 렌더 완료 후 window.__printReady = true로 Puppeteer에 신호

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { signatureDisplayName } from '../../shared/signature-display';
import { EXPENSE_RECEIPT_REPRESENTATIVE_STAMP, EXPENSE_RECEIPT_TEMPLATE_ID } from '../../shared/expense-receipt';

interface Sig {
  id: string;
  user_id: string;
  user_name?: string;
  signature_data: string;
}

interface Step {
  step_order: number;
  approver_id: string;
  approver_name?: string;
  approver_role?: string;
  status: string;
}

interface Doc {
  id: string;
  title: string;
  content: string;
  template_id?: string | null;
  author_name?: string;
  author_branch?: string;
  author_department?: string;
  author_position?: string;
}

interface ExpenseReceiptAttachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  sort_order: number;
}

interface ExpenseReceiptApprovalAction {
  action: 'approved' | 'rejected';
  actor_id: string;
  actor_name: string;
  actor_role: string;
  comment: string;
  created_at: string;
}

export default function Print() {
  const { docId } = useParams<{ docId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [doc, setDoc] = useState<Doc | null>(null);
  const [signatures, setSignatures] = useState<Sig[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [receiptAttachments, setReceiptAttachments] = useState<ExpenseReceiptAttachment[]>([]);
  const [receiptApproval, setReceiptApproval] = useState<ExpenseReceiptApprovalAction | null>(null);
  const [printPayloadLoaded, setPrintPayloadLoaded] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    (window as any).__printReady = false;
    (window as any).__printError = null;
    (window as any).__printMeta = null;
    setPrintPayloadLoaded(false);
    if (!docId || !token) {
      const message = `param 누락 — docId=${docId}, tokenLen=${token?.length || 0}`;
      (window as any).__printError = message;
      setError(message);
      return;
    }
    fetch(`/api/print/data/${docId}?token=${encodeURIComponent(token)}`)
      .then(async r => {
        if (r.ok) return r.json();
        const text = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status} — ${text.slice(0, 200)}`);
      })
      .then(data => {
        setDoc(data.document);
        setSignatures(data.signatures || []);
        setSteps(data.approval_steps || []);
        setReceiptAttachments(data.expense_receipt_attachments || []);
        setReceiptApproval(data.expense_receipt_approval_action || null);
        setPrintPayloadLoaded(true);
      })
      .catch(err => {
        const message = err.message || 'error';
        (window as any).__printError = message;
        setError(message);
      });
  }, [docId, token]);

  // 이미지 로딩 완료 후 Puppeteer에 신호
  useEffect(() => {
    if (!doc || !printPayloadLoaded) return;
    (window as any).__printReady = false;
    let cancelled = false;
    const imgs = Array.from(document.querySelectorAll('img'));
    Promise.all(imgs.map(img => {
      const image = img as HTMLImageElement;
      if (image.complete) {
        if (doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID && image.naturalWidth === 0) {
          (window as any).__printError = `이미지를 불러오지 못했습니다: ${image.alt || image.src}`;
        }
        return Promise.resolve();
      }
      return new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => {
          if (doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID) {
            (window as any).__printError = `이미지를 불러오지 못했습니다: ${image.alt || image.src}`;
          }
          resolve();
        }, { once: true });
      });
    })).then(() => {
      if (cancelled) return;
      (window as any).__printMeta = {
        documentId: doc.id,
        templateId: doc.template_id || null,
        attachmentCount: doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID ? receiptAttachments.length : 0,
      };
      (window as any).__printReady = true;
    });
    return () => { cancelled = true; };
  }, [doc, printPayloadLoaded, receiptAttachments]);

  const isPropertyReport = useMemo(() => {
    if (!doc) return false;
    try {
      const parsed = JSON.parse(doc.content);
      return parsed && typeof parsed === 'object' && 'court' in parsed;
    } catch { return false; }
  }, [doc]);
  const isExpenseReceipt = doc?.template_id === EXPENSE_RECEIPT_TEMPLATE_ID;

  if (error) return <div style={{ padding: 40, color: 'red' }}>오류: {error}</div>;
  if (!doc) return <div style={{ padding: 40 }}>로딩중...</div>;

  // PDF 페이지 크기/여백을 HTML이 직접 제어 (Puppeteer 마진 0 + preferCSSPageSize)
  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        body > div > * { box-sizing: border-box; }
      `}</style>
      <div style={{
        width: '210mm',
        minHeight: '297mm',
        padding: isExpenseReceipt ? 0 : '12mm 15mm',
        boxSizing: 'border-box',
        background: '#fff',
      }}>
        {isExpenseReceipt
          ? <ExpenseReceiptPrint doc={doc} signatures={signatures} steps={steps} attachments={receiptAttachments} approval={receiptApproval} token={token} />
          : isPropertyReport
          ? <PropertyReportPrint doc={doc} signatures={signatures} steps={steps} />
          : <GenericDocPrint doc={doc} signatures={signatures} steps={steps} />}
      </div>
    </>
  );
}

// ━━━ 일반 문서 (tiptap HTML) ━━━
type ExpenseReceiptContent = {
  version?: number;
  draft_date?: string;
  author_name?: string;
  department?: string;
  position_title?: string;
  purpose?: string;
  expense_date?: string;
  payment_method?: string;
  case_number?: string;
  client_name?: string;
  deposit_date?: string;
  deposit_amount?: number;
  bank_name?: string;
  account_number?: string;
  account_holder?: string;
  account_note?: string;
  items?: Array<{ id?: string; description?: string; amount?: number; note?: string }>;
  total_amount?: number;
};

function ExpenseReceiptPrint({ doc, signatures, steps, attachments, approval, token }: {
  doc: Doc;
  signatures: Sig[];
  steps: Step[];
  attachments: ExpenseReceiptAttachment[];
  approval: ExpenseReceiptApprovalAction | null;
  token: string;
}) {
  const content = useMemo<ExpenseReceiptContent>(() => {
    try { return JSON.parse(doc.content || '{}'); } catch { return {}; }
  }, [doc.content]);
  const items = Array.isArray(content.items) ? content.items : [];
  const authorSignature = signatures[0];
  const representativeSignature = signatures.find((signature) => signature.signature_data === EXPENSE_RECEIPT_REPRESENTATIVE_STAMP)
    || signatures.find((signature) => steps.some((step) => step.approver_role === 'ceo' && step.approver_id === signature.user_id));
  const money = (value: number | undefined) => Number(value || 0).toLocaleString('ko-KR');
  const actorRoleLabel: Record<string, string> = {
    master: '마스터', accountant: '총무담당', accountant_asst: '총무보조', ceo: '대표이사',
  };
  const cell: React.CSSProperties = { border: '1px solid #9ca3af', padding: '7px 8px', fontSize: '10pt' };
  const head: React.CSSProperties = { ...cell, background: '#f3f4f6', fontWeight: 700, textAlign: 'center', width: '17%' };

  return <>
    <section style={{ width: '210mm', minHeight: '297mm', padding: '12mm 15mm', boxSizing: 'border-box', position: 'relative', fontFamily: '"Malgun Gothic", sans-serif', color: '#111827' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <table style={{ borderCollapse: 'collapse', textAlign: 'center', fontSize: '9pt' }}>
          <thead><tr><th style={{ ...cell, width: 70 }}>담당자</th><th style={{ ...cell, width: 70 }}>대표이사</th></tr></thead>
          <tbody><tr>
            <td style={{ ...cell, height: 50 }}>{authorSignature && <img alt="담당자 서명" src={authorSignature.signature_data} style={{ width: 58, height: 36, objectFit: 'contain' }} />}</td>
            <td style={{ ...cell, height: 50 }}>{representativeSignature && <img alt="대표이사 직인" src={representativeSignature.signature_data} style={{ width: 58, height: 42, objectFit: 'contain' }} />}</td>
          </tr></tbody>
        </table>
      </div>
      <h1 style={{ textAlign: 'center', fontSize: '22pt', letterSpacing: 7, margin: '5mm 0 10mm' }}>지 출 결 의 서</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}><tbody>
        <tr><th style={head}>기안일</th><td style={cell}>{content.draft_date || ''}</td><th style={head}>기안자</th><td style={cell}>{content.author_name || doc.author_name || ''}</td></tr>
        <tr><th style={head}>부서</th><td style={cell}>{content.department || doc.author_department || ''}</td><th style={head}>직급</th><td style={cell}>{content.position_title || doc.author_position || ''}</td></tr>
        <tr><th style={head}>지출 목적</th><td style={{ ...cell, minHeight: 48 }} colSpan={3}>{content.purpose || ''}</td></tr>
        <tr><th style={head}>지급 방법</th><td style={cell} colSpan={3}>{content.payment_method || ''}</td></tr>
        <tr><th style={head}>사건번호</th><td style={cell}>{content.case_number || ''}</td><th style={head}>고객명</th><td style={cell}>{content.client_name || ''}</td></tr>
        <tr><th style={head}>입금일</th><td style={cell}>{content.deposit_date || ''}</td><th style={head}>입금액</th><td style={cell}>{content.deposit_amount ? `${money(content.deposit_amount)}원` : ''}</td></tr>
        <tr><th style={head}>은행명</th><td style={cell}>{content.bank_name || ''}</td><th style={head}>계좌번호</th><td style={cell}>{content.account_number || ''}</td></tr>
        <tr><th style={head}>예금주</th><td style={cell}>{content.account_holder || ''}</td><th style={head}>비고</th><td style={cell}>{content.account_note || ''}</td></tr>
      </tbody></table>
      <h2 style={{ fontSize: '12pt', margin: '8mm 0 3mm' }}>지출 내역</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>
        <th style={{ ...head, width: '8%' }}>번호</th><th style={{ ...head, width: '42%' }}>항목</th><th style={{ ...head, width: '22%' }}>금액</th><th style={{ ...head, width: '28%' }}>비고</th>
      </tr></thead><tbody>
        {items.map((item, index) => <tr key={item.id || index}><td style={{ ...cell, textAlign: 'center' }}>{index + 1}</td><td style={cell}>{item.description || ''}</td><td style={{ ...cell, textAlign: 'right' }}>{money(item.amount)}원</td><td style={cell}>{item.note || ''}</td></tr>)}
        <tr><th style={head} colSpan={2}>합계</th><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{money(content.total_amount)}원</td><td style={cell}></td></tr>
      </tbody></table>
      <p style={{ textAlign: 'center', marginTop: '12mm', fontSize: '10pt' }}>위와 같이 지출하고자 결의하오니 승인하여 주시기 바랍니다.</p>
      {approval?.action === 'approved' && <div style={{ position: 'absolute', left: '15mm', right: '15mm', bottom: '9mm', borderTop: '1px solid #d1d5db', paddingTop: 4, color: '#6b7280', fontSize: '8pt', textAlign: 'right' }}>
        실제 승인자: {approval.actor_name}{approval.actor_role ? `(${actorRoleLabel[approval.actor_role] || approval.actor_role})` : ''} / 승인일시: {approval.created_at}
      </div>}
    </section>
    {attachments.map((attachment, index) => <section key={attachment.id} style={{ width: '210mm', height: '297mm', padding: '12mm 15mm', boxSizing: 'border-box', pageBreakBefore: 'always', breakBefore: 'page', display: 'flex', flexDirection: 'column', fontFamily: '"Malgun Gothic", sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #d1d5db', paddingBottom: 5, marginBottom: 8, fontSize: '9pt' }}><strong>영수증 {index + 1}</strong><span>{attachment.file_name}</span></div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt={`영수증 ${index + 1}: ${attachment.file_name}`} src={`/api/print/expense-receipts/${encodeURIComponent(doc.id)}/attachments/${encodeURIComponent(attachment.id)}?token=${encodeURIComponent(token)}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    </section>)}
  </>;
}

function GenericDocPrint({ doc, signatures, steps }: { doc: Doc; signatures: Sig[]; steps: Step[] }) {
  const used = new Set<string>();
  const slots: { label: string; sig?: Sig }[] = [];
  const authorSig = signatures[0];
  if (authorSig) used.add(authorSig.id);
  slots.push({ label: '작성자', sig: authorSig });
  for (const step of steps) {
    const isCeo = step.approver_role === 'ceo';
    let stepSig: Sig | undefined;
    if (isCeo) {
      stepSig = signatures.find(s => s.signature_data === '/LNCstemp.png' && !used.has(s.id));
    }
    if (!stepSig) {
      stepSig = signatures.find((s, idx) => s.user_id === step.approver_id && idx >= 1 && !used.has(s.id));
    }
    if (stepSig) used.add(stepSig.id);
    slots.push({ label: step.approver_name || `승인 ${step.step_order}`, sig: stepSig });
  }
  if (steps.length === 0 && signatures[1]) slots.push({ label: '승인자', sig: signatures[1] });

  return (
    <div style={{
      fontFamily: '"Malgun Gothic", "맑은 고딕", sans-serif',
      color: '#202124',
      padding: '0',
      background: '#fff',
      width: '100%',
    }}>
      {/* 결재란 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 9 }}>
          <thead>
            <tr>
              {slots.map((s, i) => (
                <th key={i} style={{ border: '1px solid #999', padding: '3px 8px', background: '#f5f5f5', width: 60, textAlign: 'center' }}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {slots.map((s, i) => (
                <td key={i} style={{ border: '1px solid #999', padding: 3, height: 45, width: 60, textAlign: 'center', verticalAlign: 'middle' }}>
                  {s.sig && (
                    <>
                      <img src={s.sig.signature_data} style={{ width: 55, height: 28, objectFit: 'contain' }} />
                      <div style={{ fontSize: 8, color: '#666', marginTop: 2 }}>{signatureDisplayName(s.sig)}</div>
                    </>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h2 style={{ textAlign: 'center', marginBottom: 16, fontSize: 18 }}>{doc.title}</h2>
      <div dangerouslySetInnerHTML={{ __html: doc.content || '' }} style={{ fontSize: 12, lineHeight: 1.6 }} />
    </div>
  );
}

// ━━━ 물건분석보고서 (JSON → 레이아웃) — 실제 PropertyReport 페이지 필드 스키마 사용 ━━━
function PropertyReportPrint({ doc, signatures, steps }: { doc: Doc; signatures: Sig[]; steps: Step[] }) {
  const fields: any = useMemo(() => {
    try { return JSON.parse(doc.content); } catch { return {}; }
  }, [doc.content]);

  // 결재란 슬롯 구성 (작성자 + 승인 단계들)
  const headers = ['작성자'];
  steps.forEach(s => headers.push(s.approver_name || '승인자'));
  if (steps.length === 0) headers.push('결재자');

  const slotSigs: (Sig | null)[] = Array(headers.length).fill(null);
  if (signatures[0]) slotSigs[0] = signatures[0];
  const usedIds = new Set<string>();
  if (signatures[0]) usedIds.add(signatures[0].id);
  steps.forEach((step, idx) => {
    if (idx + 1 >= headers.length) return;
    let sig: Sig | undefined;
    // CEO step → 대표 직인 우선
    if (step.approver_role === 'ceo') {
      sig = signatures.find(s => s.signature_data === '/LNCstemp.png' && !usedIds.has(s.id));
    }
    // 일반: approver_id 매칭
    if (!sig) {
      sig = signatures.find(s => s.user_id === step.approver_id && signatures.indexOf(s) >= 1 && !usedIds.has(s.id));
    }
    // approved인데 매칭 실패 → 남은 서명 순서대로
    if (!sig && step.status === 'approved') {
      sig = signatures.find(s => signatures.indexOf(s) >= 1 && !usedIds.has(s.id));
    }
    if (sig) { slotSigs[idx + 1] = sig; usedIds.add(sig.id); }
  });

  // placeholder span 제거
  const cleanHtml = (html: string): string => {
    if (!html) return '';
    return html.replace(/<span[^>]*color:\s*#ccc[^>]*>[\s\S]*?<\/span>/gi, '');
  };

  const thS: React.CSSProperties = {
    border: '1px solid #c5cdd8', padding: '3px 6px',
    background: '#eef1f5', fontWeight: 700, textAlign: 'center',
    whiteSpace: 'nowrap', color: '#1a2744', fontSize: '8.5pt',
  };
  const tdS: React.CSSProperties = {
    border: '1px solid #c5cdd8', padding: '3px 6px', fontSize: '8.5pt',
  };
  const sectTitle: React.CSSProperties = {
    fontSize: '10pt', fontWeight: 800, color: '#1a2744',
    borderLeft: '3px solid #1a2744', paddingLeft: 8,
    margin: '10px 0 4px', letterSpacing: 1,
  };

  return (
    <div style={{
      width: '100%', fontFamily: "'맑은 고딕','Malgun Gothic',sans-serif",
      fontSize: '9pt', color: '#1a1a1a', lineHeight: 1.45, background: '#fff',
    }}>
      {/* 헤더: 제목 + 결재란 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, borderBottom: '3px solid #1a2744', paddingBottom: 6 }}>
        <div>
          <div style={{ fontSize: '7pt', color: '#8a9ab5', letterSpacing: 2, marginBottom: 1 }}>PROPERTY ANALYSIS REPORT</div>
          <div style={{ fontSize: '18pt', fontWeight: 800, color: '#1a2744', letterSpacing: 5 }}>물건분석 보고서</div>
        </div>
        <table style={{ borderCollapse: 'collapse', fontSize: '7.5pt', textAlign: 'center' }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{ border: '1px solid #c5cdd8', padding: '2px 10px', background: '#eef1f5', fontWeight: 700, color: '#1a2744', fontSize: '7pt' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {slotSigs.map((sig, i) => (
                <td key={i} style={{ border: '1px solid #c5cdd8', padding: '1px 3px', height: 30, minWidth: 48, textAlign: 'center', verticalAlign: 'middle' }}>
                  {sig?.signature_data ? <img src={sig.signature_data} style={{ height: 22, objectFit: 'contain' }} /> : '\u00A0'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* 권리분석의 대상 */}
      <div style={sectTitle}>권리분석의 대상</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
        <tbody>
          <tr>
            <th style={{ ...thS, width: 80 }}>법원</th>
            <td style={tdS}>{fields.court || ''}</td>
            <th style={{ ...thS, width: 80 }}>사건번호</th>
            <td style={tdS}>{fields.caseNo || ''}</td>
          </tr>
          <tr>
            <th style={{ ...thS, width: 80 }}>감정가</th>
            <td style={tdS}>{fields.appraisalPrice || ''}</td>
            <th style={{ ...thS, width: 80 }}>물건종류</th>
            <td style={tdS}>{fields.propertyType || ''}</td>
          </tr>
          <tr>
            <th style={{ ...thS, width: 80 }}>대상물표시</th>
            <td style={tdS} colSpan={3}>{fields.propertyDesc || ''}</td>
          </tr>
        </tbody>
      </table>

      {/* 권리분석 내용 */}
      <div style={sectTitle}>권리분석 내용</div>
      <div style={{ fontSize: '8.5pt', lineHeight: 1.5 }}>
        <div style={{ marginBottom: 3 }}>
          1. <b style={{ color: '#1a2744' }}>말소기준 및 등기부상 소멸 불가 사항</b>
          <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', minHeight: '1.3em' }}
            dangerouslySetInnerHTML={{ __html: cleanHtml(fields.extinguish) }} />
        </div>
        <div style={{ marginBottom: 3 }}>
          2. <b style={{ color: '#1a2744' }}>임차권리 인수사항</b>
          <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', minHeight: '1.3em' }}
            dangerouslySetInnerHTML={{ __html: cleanHtml(fields.priority) }} />
        </div>
        <div style={{ marginBottom: 3 }}>
          3. <b style={{ color: '#1a2744' }}>무잉여·취하 가능성</b>
          <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', minHeight: '1.3em' }}
            dangerouslySetInnerHTML={{ __html: cleanHtml(fields.futile) }} />
        </div>
        <div style={{ marginBottom: 3 }}>
          4. <b style={{ color: '#1a2744' }}>특이사항</b>
          <div style={{ borderBottom: '1px solid #aaa', padding: '2px 4px', minHeight: '1.3em' }}
            dangerouslySetInnerHTML={{ __html: cleanHtml(fields.special) }} />
        </div>
      </div>

      {/* 미납관리비 */}
      {(fields.unpaidAmount || fields.mgmtBasis || fields.unpaidPeriod) && (
        <>
          <div style={sectTitle}>미납관리비</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
            <tbody>
              <tr>
                <th style={{ ...thS, width: 80 }}>금액</th>
                <td style={tdS}>{fields.unpaidAmount || ''}</td>
                <th style={{ ...thS, width: 80 }}>기준</th>
                <td style={tdS}>{fields.mgmtBasis || ''}</td>
                <th style={{ ...thS, width: 80 }}>기간</th>
                <td style={tdS}>{fields.unpaidPeriod || ''}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* 컨설팅 계약조건 — 번호 조항 박스 */}
      <div style={sectTitle}>컨설팅 계약조건</div>
      <div style={{ border: '1.5px solid #c5cdd8', borderRadius: 3, padding: '6px 10px', fontSize: '8.5pt', lineHeight: 1.45, background: '#fafbfc' }}>
        <div style={{ marginBottom: 2 }}>
          1. 상기 컨설팅에 대한 낙찰수수료는 <span style={{ borderBottom: '1px solid #aaa', padding: '0 4px', minWidth: 80, display: 'inline-block' }}>{fields.commissionRate || ''}</span> (부가세별도)로 한다.
        </div>
        <div style={{ marginBottom: 2 }}>
          2. 명도수수료 조건은 [정액제 / 실비제]로 한다.
          <div style={{ paddingLeft: '1em', fontSize: '8pt', lineHeight: 1.4, color: '#333' }}>
            <b style={{ color: '#1a2744' }}>정액제</b> : 회사에 필요한 명도비를 모두 지급하고 명도에 관한 비용은 을의 법률 사무소가 부담한다.<br />
            <b style={{ color: '#1a2744' }}>실비제</b> : 법률 사무소 수수료는 주거용 최대 150만원, 그 외 기타물건 최대 300만원을 초과하지 않으며 명도 관련 제비용은 발생시마다 의뢰인이 지급하기로 한다.
          </div>
        </div>
        <div style={{ marginBottom: 2 }}>
          3. 낙찰자 명의는 <span style={{ borderBottom: '1px solid #aaa', padding: '0 4px', minWidth: 80, display: 'inline-block' }}>{fields.bidderName || ''}</span>(으)로 하고 약관에 따른다.
        </div>
        <div>
          4. 수수료는 당일 지급하기로 한다. <span style={{ fontSize: '7.5pt', color: '#1a2744', fontWeight: 600 }}>신한은행 100-026-996624 (주)엘앤씨부동산중개법인</span>
        </div>
      </div>

      {/* 서명 테이블 — 甲(의뢰인) + 乙(마이옥션) 통합 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: '8pt' }}>
        <tbody>
          {/* 의뢰인(甲) 3행 */}
          <tr>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#e4e8ee', textAlign: 'center', fontWeight: 800, width: 36, fontSize: '7.5pt', color: '#1a2744' }} rowSpan={3}>(甲)<br />의뢰인</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', width: 56, fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>성 명</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.clientName || ''}</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', width: 56, fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>주민번호</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.clientSsn || ''}</td>
            <td style={{ border: '1px solid #c5cdd8', padding: '2px', width: 44, textAlign: 'center', verticalAlign: 'middle', fontSize: '7pt', color: '#bbb', background: '#fcfcfd' }} rowSpan={3}>(인)</td>
          </tr>
          <tr>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>전화번호</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.clientPhone || ''}</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>이메일</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.clientEmail || ''}</td>
          </tr>
          <tr>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>주 소</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }} colSpan={3}>{fields.clientAddr || ''}</td>
          </tr>
          {/* 마이옥션(乙) 3행 */}
          <tr>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#e4e8ee', textAlign: 'center', fontWeight: 800, width: 36, fontSize: '7pt', color: '#1a2744' }} rowSpan={3}>(乙)<br />마이옥션<br />㈜엘앤씨</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>상 호</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>㈜엘앤씨부동산중개법인</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>전화번호</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>1544-6542</td>
            <td style={{ border: '1px solid #c5cdd8', padding: '1px', width: 48, textAlign: 'center', verticalAlign: 'middle', background: '#fcfcfd' }} rowSpan={3}>
              <img src="/LNCstemp.png" style={{ width: 42, height: 42, objectFit: 'contain' }} />
            </td>
          </tr>
          <tr>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt', whiteSpace: 'nowrap' }}>사업자번호</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>127-86-29704</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>홈페이지</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>www.my-auction.co.kr</td>
          </tr>
          <tr>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>담 당 자</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.staffName || doc.author_name || ''}</td>
            <th style={{ border: '1px solid #c5cdd8', padding: '3px 5px', background: '#eef1f5', textAlign: 'center', fontWeight: 700, color: '#1a2744', fontSize: '7.5pt' }}>연락처</th>
            <td style={{ border: '1px solid #c5cdd8', padding: '3px 5px' }}>{fields.staffPhone || ''}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 5, fontSize: '8pt', color: '#333', padding: '4px 0', borderTop: '1.5px solid #c5cdd8' }}>
        ☐ 본인은 개인정보 수집·이용에 동의합니다. (뒷면 개인정보 수집·이용 동의 내용 참조)
      </div>

      {fields.writeDate && (
        <div style={{ textAlign: 'right', fontSize: '9pt', color: '#5f6368', marginTop: 8 }}>
          작성일: {fields.writeDate}
        </div>
      )}
    </div>
  );
}
