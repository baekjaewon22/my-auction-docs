// 서버 Puppeteer가 navigate 하는 인쇄 전용 페이지
// - printToken으로 인증 없이 문서 데이터 fetch
// - 일반 문서: tiptap HTML 렌더
// - 물건분석보고서: JSON → PropertyReport 전용 레이아웃으로 렌더
// - 렌더 완료 후 window.__printReady = true로 Puppeteer에 신호

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

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
  author_name?: string;
  author_branch?: string;
  author_department?: string;
  author_position?: string;
}

export default function Print() {
  const { docId } = useParams<{ docId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [doc, setDoc] = useState<Doc | null>(null);
  const [signatures, setSignatures] = useState<Sig[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!docId || !token) { setError(`param 누락 — docId=${docId}, tokenLen=${token?.length || 0}`); return; }
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
      })
      .catch(err => setError(err.message || 'error'));
  }, [docId, token]);

  // 이미지 로딩 완료 후 Puppeteer에 신호
  useEffect(() => {
    if (!doc) return;
    const imgs = Array.from(document.querySelectorAll('img'));
    Promise.all(imgs.map(img => {
      if ((img as HTMLImageElement).complete) return Promise.resolve();
      return new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    })).then(() => {
      (window as any).__printReady = true;
    });
  }, [doc]);

  const isPropertyReport = useMemo(() => {
    if (!doc) return false;
    try {
      const parsed = JSON.parse(doc.content);
      return parsed && typeof parsed === 'object' && 'court' in parsed;
    } catch { return false; }
  }, [doc]);

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
        padding: '12mm 15mm',
        boxSizing: 'border-box',
        background: '#fff',
      }}>
        {isPropertyReport
          ? <PropertyReportPrint doc={doc} signatures={signatures} steps={steps} />
          : <GenericDocPrint doc={doc} signatures={signatures} steps={steps} />}
      </div>
    </>
  );
}

// ━━━ 일반 문서 (tiptap HTML) ━━━
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
                      <div style={{ fontSize: 8, color: '#666', marginTop: 2 }}>{s.sig.user_name || ''}</div>
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
