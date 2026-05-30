import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, FileDown, HelpCircle, Printer, UploadCloud } from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';

type UploadKind = 'bank' | 'checkCard';
type AccountingReportKind = 'sales' | 'expense' | 'profit-loss' | 'check-card' | 'tax' | 'audit';

type ParsedUpload = {
  kind: UploadKind;
  fileName: string;
  rowCount: number;
  rows: any[];
  sampleRows: any[];
  totalIncome?: number;
  totalExpense?: number;
};

type CardAssignmentRule = {
  id: string;
  last4: string;
  branch: string;
  owner: string;
  memo: string;
};

type MerchantKeywordRule = {
  id: string;
  keyword: string;
  category: string;
  item: string;
  memo: string;
};

const SESSION_KEY = 'accounting_session1_uploads';
const AUTO_MATCH_LOG_KEY = 'accounting_session1_auto_match_log';
const LABOR_COST_EXTRA_USER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const PROFIT_LOSS_EXTRA_USER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const REPORT_BRANCHES = ['전체', '의정부본사', '서초', '대전', '부산'];
const BRANCH_OPTIONS = ['의정부본사', '서초지사', '대전지사', '부산지사', '본사관리'];

const ACCOUNTING_REPORT_META: Record<AccountingReportKind, { title: string; desc: string; path: string }> = {
  sales: { title: '실적/매출 장부', desc: '업무성과와 매출 분류 건을 실적관리 양식으로 확인합니다.', path: '/accounting-session2/reports/sales' },
  expense: { title: '지출/거래 원장', desc: '통장, 체크카드, 신용카드 지출을 통합 원장으로 확인합니다.', path: '/accounting-session2/reports/expense' },
  'profit-loss': { title: '손익결산', desc: '지사별 월별 매출과 지출 합계로 손익을 확인합니다.', path: '/accounting-session2/reports/profit-loss' },
  'check-card': { title: '체크카드 사용내역', desc: '체크카드 원천 사용내역과 카드 뒷자리 매칭 정보를 확인합니다.', path: '/accounting-session2/reports/check-card' },
  tax: { title: '세무자료', desc: '세금, 인건비, 신고 대상 지출 항목을 분리해 확인합니다.', path: '/accounting-session2/reports/tax' },
  audit: { title: '검토로그', desc: '업로드, 중복, 대체, 연결 상태를 감사용으로 확인합니다.', path: '/accounting-session2/reports/audit' },
};

const DEFAULT_KEYWORD_GROUPS = [
  { category: '통신요금', item: '대표번호/팩스/인터넷', keywords: ['KT통신요금', 'KT08268923', 'LGU+오피스넷', 'LGU+BS', 'LGU+대표번호', 'LGU+인터넷'] },
  { category: '고정비', item: '렌탈/단말기', keywords: ['신도디지탈', '프린터임대료', '복합기렌탈', '쿠쿠렌탈료', '현대렌탈케어', '코웨이렌탈', 'SK매직', '성보SNT'] },
  { category: '홈페이지', item: '광고/문자', keywords: ['N인터넷광고비', 'GOOGLE', 'D인터넷광고비', '애플앱광고비', '삼정데이타', '문자발송충전', 'SMS100'] },
  { category: '영업비', item: '광고/전자민원', keywords: ['지지옥션', '전자민원', 'DM발송', '창봉투'] },
  { category: '기타', item: '우편료', keywords: ['우정사업본부', '우편발송'] },
  { category: '고정비', item: '식대', keywords: ['식당', '반점', '설렁탕', '해장국', '순대국', '부대찌개', '돈까스', '짬뽕', '국수', '김밥', '추어탕', '맥도날드', '써브웨이', 'KFC'] },
  { category: '고정비', item: '유류/주차', keywords: ['주유소', '석유', '오일뱅크', 'SK에너지', '칼텍스', '도로공사', '주차장', '주차', '파킹', '아마노코리아'] },
  { category: '기타', item: '비품/문구', keywords: ['쿠팡', 'GS25', '세븐일레븐', '리빙아울렛', '물티슈', 'A4용지', '휴지', '종이컵', '커피믹스', '원두'] },
  { category: '기타', item: '출장/숙소/회식', keywords: ['대한항공', '진에어', '제주항공', '에어부산', '호텔', '모텔', '게스트', '뒷고기', '생고기', '노래연습장'] },
];

const ACCOUNTING_CATEGORY_ITEMS: Record<string, string[]> = {
  매출: ['계약', '낙찰', '권리분석', '중개', '기타매출'],
  인건비: ['직원급여', '컨설턴트 실적급여', '매수신청대리', '낙찰가입력', '명도비', '퇴직금'],
  세금: ['4대보험', '부가세', '소득세', '주민세', '법인세', '등록면허세', '지방세', '자동차세'],
  사무실관련: ['임대료', '관리비', '전기요금', '인테리어', '중개수수료', '권리금·보증금'],
  통신요금: ['LGU+인터넷', '인터넷전화(LGU)', 'LG대표번호서비스', '대표번호(KT)', '팩스(KT)', '대표번호(SKB)', '대표번호(Tplus)', 'LGU+유선전화'],
  홈페이지: ['문자발송충전', '서버호스팅', '홈페이지 관리비', '채널톡이용요금', '앱제작·등록비'],
  영업비: ['키워드광고(네이버)충전', '키워드광고(다음)충전', '키워드광고(구글)충전', '키워드광고(애플)충전', '키워드광고대행비', '지지옥션연장결제', '전자민원캐시', 'DM발송(창봉투)'],
  고정비: ['식대', '복사기·프린터 렌탈', '정수기 렌탈', '공기청정기 렌탈', '발매트 렌탈', '파쇄기 렌탈', '카드단말기', '문자통지료', '숙소비', '세무기장료', '전자계약서 이용결제', 'Adobe 서비스이용결제', '자문비용', '주차비'],
  기타: ['우편료', '비품', '출장비', '커피·녹차', '문구류', '명함인쇄', 'A4용지·A3인쇄', '사무기기', '화환배송비용', '회식비·야유회비용', '인감발급·송달료·공인인증수수료', '박람회비용', '명도비(집행관보관금)'],
};

const ACCOUNTING_CATEGORY_OPTIONS = Object.keys(ACCOUNTING_CATEGORY_ITEMS);

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function formatMoney(value: unknown, suffix = '원') {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '-';
  return `${number.toLocaleString('ko-KR')}${suffix}`;
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function formatTransactionDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + Math.floor(value));
    return base.toISOString().slice(0, 10);
  }
  return normalizeText(value);
}

function formatShortDate(value: unknown) {
  const text = formatTransactionDate(value);
  const match = text.match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (!match) return text.slice(0, 10) || '-';
  return `${match[2].padStart(2, '0')}월${match[3].padStart(2, '0')}일`;
}

function formatSignedMoney(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return '0';
  const sign = number > 0 ? '+' : '-';
  return `${sign}${Math.abs(number).toLocaleString('ko-KR')}`;
}

function formatKstDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function optionList(base: string[], current?: unknown) {
  const value = normalizeText(current);
  return Array.from(new Set([...base, value].filter(Boolean)));
}

function getItemOptions(category?: unknown, current?: unknown) {
  return optionList(ACCOUNTING_CATEGORY_ITEMS[normalizeText(category)] || [], current);
}

function ComboInput({
  value,
  options,
  placeholder,
  className,
  onChange,
}: {
  value?: string;
  options: string[];
  placeholder: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const listId = `combo-${generatedId.replace(/:/g, '')}`;
  return (
    <>
      <input
        className={className}
        value={value || ''}
        list={listId}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {optionList(options, value).map((option) => <option key={option} value={option} />)}
      </datalist>
    </>
  );
}

function readSession(): Record<UploadKind, ParsedUpload | null> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : { bank: null, checkCard: null };
  } catch {
    return { bank: null, checkCard: null };
  }
}

function writeSession(session: Record<UploadKind, ParsedUpload | null>) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function readAutoMatchLog(): Record<UploadKind, string> {
  try {
    const raw = localStorage.getItem(AUTO_MATCH_LOG_KEY);
    return raw ? { bank: '', checkCard: '', ...JSON.parse(raw) } : { bank: '', checkCard: '' };
  } catch {
    return { bank: '', checkCard: '' };
  }
}

function writeAutoMatchLog(log: Record<UploadKind, string>) {
  localStorage.setItem(AUTO_MATCH_LOG_KEY, JSON.stringify(log));
}

function compactBranchName(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isRestrictedBranchForAccountingAsst(branch: unknown): boolean {
  const compact = compactBranchName(branch);
  return compact === '의정부' || compact === '의정부본사';
}

function isAccountingAsstAllowedBranch(user?: { role?: string; branch?: string } | null) {
  return user?.role !== 'accountant_asst' || (!!user.branch && !isRestrictedBranchForAccountingAsst(user.branch));
}

function canAccessProfitLossReportForUser(user?: { id?: string; role?: string; branch?: string } | null) {
  if (!user) return false;
  if (user.role === 'accountant_asst') return isAccountingAsstAllowedBranch(user);
  return ['master', 'ceo', 'accountant'].includes(user.role || '') || PROFIT_LOSS_EXTRA_USER_IDS.includes(user.id || '');
}

function canAccessForecastReportForUser(user?: { id?: string; role?: string } | null) {
  if (!user) return false;
  return ['master', 'ceo', 'accountant'].includes(user.role || '') || PROFIT_LOSS_EXTRA_USER_IDS.includes(user.id || '');
}

function canAccessLaborCostReportForUser(user?: { id?: string; role?: string } | null) {
  return !!user && (['master', 'ceo', 'accountant'].includes(user.role || '') || LABOR_COST_EXTRA_USER_IDS.includes(user.id || ''));
}

function normalizeReportBranch(value: unknown) {
  const text = normalizeText(value).replace(/\s+/g, '');
  if (!text || text === '전체') return '';
  if (text.includes('의정부')) return '의정부본사';
  if (text.includes('서초')) return '서초';
  if (text.includes('대전')) return '대전';
  if (text.includes('부산')) return '부산';
  if (text.includes('본사관리')) return '본사관리';
  return normalizeText(value);
}

function getVisibleAccountingReportKinds(user?: { id?: string; role?: string } | null): AccountingReportKind[] {
  return (Object.keys(ACCOUNTING_REPORT_META) as AccountingReportKind[])
    .filter((kind) => kind !== 'profit-loss' || canAccessProfitLossReportForUser(user));
}

async function parseWorkbook(file: File, kind: UploadKind): Promise<ParsedUpload> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  const rows = rawRows
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row, index) => {
      if (kind === 'bank') {
        const income = toNumber(row[2]);
        const expense = toNumber(row[3]);
        const amount = income > 0 ? income : -Math.abs(expense);
        const transactionAt = formatTransactionDate(row[0]);
        return {
          id: `${kind}-${index}`,
          source_type: 'bank',
          source_key: `bank:${transactionAt}:${income}:${expense}:${normalizeText(row[4])}:${normalizeText(row[6])}`,
          date: transactionAt,
          transaction_at: transactionAt,
          transaction_type: row[1],
          direction: amount >= 0 ? '입금' : '출금',
          income,
          expense,
          amount,
          description: row[4],
          balance: row[5],
          counterparty: row[6],
          raw: row,
        };
      }
      const cardText = normalizeText(row.join(' '));
      const cardLast4 = (cardText.match(/(\d{4})(?!.*\d{4})/) || [])[1] || '';
      return {
        id: `${kind}-${index}`,
        source_type: 'checkCard',
        date: formatTransactionDate(row[0]),
        transaction_at: formatTransactionDate(row[0]),
        card_last4: cardLast4,
        merchant: row[5] || row[4] || row[2],
        amount: -Math.abs(toNumber(row[6] || row[5] || row[3])),
        raw: row,
      };
    });
  return {
    kind,
    fileName: file.name,
    rowCount: rows.length,
    rows,
    sampleRows: rows.slice(0, 8),
    totalIncome: rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0),
    totalExpense: rows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.amount || 0))), 0),
  };
}

function AccountingWorkflowNav({ current }: { current: string }) {
  const steps = [
    { id: 'upload', title: '원천자료 업로드', path: '/accounting-session1/bank' },
    { id: 'check-card', title: '체크카드 점검', path: '/accounting-session1/check-card' },
    { id: 'engine', title: '분류엔진', path: '/accounting-session1/engine' },
    { id: 'review', title: '저장 반영', path: '/accounting-session2' },
    { id: 'reports', title: '출력물', path: '/accounting-session2/reports' },
  ];
  const index = steps.findIndex((step) => step.id === current);
  const next = steps[index + 1];
  return (
    <section className="accounting-workflow-nav compact">
      <div className="accounting-workflow-head">
        <div>
          <strong>회계 처리 순서</strong>
          <span>원천 업로드부터 검토, 저장, 출력까지 순서대로 진행합니다.</span>
        </div>
        {next && <Link to={next.path} className="btn btn-primary">다음: {next.title} <ArrowRight size={15} /></Link>}
      </div>
      <div className="accounting-stepper">
        {steps.map((step, stepIndex) => (
          <Link key={step.id} to={step.path} className={`accounting-step ${step.id === current ? 'active' : ''} ${stepIndex < index ? 'done' : ''}`}>
            <b>{stepIndex + 1}</b>
            <span>{step.title}</span>
            <em>{stepIndex < index ? '완료' : step.id === current ? '현재 단계' : '대기'}</em>
          </Link>
        ))}
      </div>
    </section>
  );
}

function UploadBox({ kind, title }: { kind: UploadKind; title: string }) {
  const [session, setSession] = useState(readSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const data = session[kind];
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const parsed = await parseWorkbook(file, kind);
      const next = { ...session, [kind]: parsed };
      setSession(next);
      writeSession(next);
    } catch (err: any) {
      setError(err?.message || '엑셀 파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card accounting-upload-card">
      <h3>{title}</h3>
      <p>{kind === 'bank' ? 'original.xlsx 양식의 통장 거래내역을 업로드합니다.' : 'originalcheck.xls 양식의 체크카드 사용내역을 업로드합니다.'}</p>
      <label className="accounting-upload-zone">
        <UploadCloud size={24} />
        <span>{busy ? '읽는 중...' : data ? data.fileName : '클릭하거나 파일을 끌어다 놓으세요'}</span>
        <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => onFile(event.target.files?.[0])} />
      </label>
      {error && <div className="accounting-auto-status warning">{error}</div>}
      {data && (
        <div className="accounting-summary-grid">
          <div><strong>{data.rowCount.toLocaleString()}건</strong><span>읽은 행</span></div>
          <div><strong>{formatMoney(data.totalIncome)}</strong><span>입금 합계</span></div>
          <div><strong>{formatMoney(data.totalExpense)}</strong><span>출금 합계</span></div>
        </div>
      )}
    </section>
  );
}

function PreviewTable({ rows, ownerOptions = [], onUpdateRow }: {
  rows: any[];
  ownerOptions?: string[];
  onUpdateRow?: (row: any, patch: Record<string, string>) => void;
}) {
  const isBank = rows.some((row) => row.source_type === 'bank');
  return (
    <div className="table-wrap accounting-engine-table-wrap">
      <table className={`data-table accounting-report-table ${isBank ? 'accounting-bank-preview-table' : ''}`}>
        <thead>
          {isBank ? (
            <tr>
              <th>날짜</th>
              <th>거래시간</th>
              <th>구분</th>
              <th className="report-number">입/출금</th>
              <th>내역</th>
              <th>사용처</th>
              <th className="report-number">잔액</th>
              <th>분류</th>
              <th>항목</th>
              <th>담당자</th>
            </tr>
          ) : (
            <tr>
              <th>날짜</th>
              <th>카드</th>
              <th>가맹점</th>
              <th className="report-number">금액</th>
              <th>분류</th>
              <th>항목</th>
              <th>지사</th>
              <th>담당자</th>
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row, index) => (
            isBank ? (
              <tr key={row.id || index}>
                <td title={normalizeText(row.date)}>{formatShortDate(row.date)}</td>
                <td title={normalizeText(row.transaction_at || row.date)}>{normalizeText(row.transaction_at || row.date).slice(11, 19) || '-'}</td>
                <td title={normalizeText(row.transaction_type || row.direction)}>{row.transaction_type || row.direction || '-'}</td>
                <td className={`report-number ${Number(row.amount || 0) >= 0 ? 'report-positive' : 'report-negative'}`}>{formatSignedMoney(row.amount)}</td>
                <td title={normalizeText(row.description)}>{row.description || '-'}</td>
                <td title={normalizeText(row.counterparty)}>{row.counterparty || '-'}</td>
                <td className="report-number" title={normalizeText(row.balance)}>{Number(row.balance || 0).toLocaleString('ko-KR')}</td>
                <td>
                  <ComboInput
                    className={`accounting-engine-combo ${!row.category ? 'field-warning' : ''}`}
                    value={row.category || ''}
                    options={ACCOUNTING_CATEGORY_OPTIONS}
                    placeholder="분류"
                    onChange={(value) => onUpdateRow?.(row, { category: value, item: '' })}
                  />
                </td>
                <td>
                  <ComboInput
                    className={`accounting-engine-combo ${!row.item ? 'field-warning' : ''}`}
                    value={row.item || ''}
                    options={getItemOptions(row.category, row.item)}
                    placeholder="항목"
                    onChange={(value) => onUpdateRow?.(row, { item: value })}
                  />
                </td>
                <td>
                  <ComboInput
                    className="accounting-engine-combo"
                    value={row.owner_name || ''}
                    options={ownerOptions}
                    placeholder="담당자"
                    onChange={(value) => onUpdateRow?.(row, { owner_name: value })}
                  />
                </td>
              </tr>
            ) : (
              <tr key={row.id || index}>
                <td title={normalizeText(row.date)}>{formatShortDate(row.date)}</td>
                <td>{row.card_last4 ? `****-${row.card_last4}` : '-'}</td>
                <td title={normalizeText(row.merchant || row.description)}>{row.merchant || row.description || '-'}</td>
                <td className="report-number">{formatSignedMoney(row.amount)}</td>
                <td>
                  <ComboInput
                    className={`accounting-engine-combo ${!row.category ? 'field-warning' : ''}`}
                    value={row.category || ''}
                    options={ACCOUNTING_CATEGORY_OPTIONS}
                    placeholder="분류"
                    onChange={(value) => onUpdateRow?.(row, { category: value, item: '' })}
                  />
                </td>
                <td>
                  <ComboInput
                    className={`accounting-engine-combo ${!row.item ? 'field-warning' : ''}`}
                    value={row.item || ''}
                    options={getItemOptions(row.category, row.item)}
                    placeholder="항목"
                    onChange={(value) => onUpdateRow?.(row, { item: value })}
                  />
                </td>
                <td>
                  <ComboInput
                    className={`accounting-engine-combo ${!row.branch ? 'field-warning' : ''}`}
                    value={row.branch || ''}
                    options={BRANCH_OPTIONS}
                    placeholder="지사"
                    onChange={(value) => onUpdateRow?.(row, { branch: value })}
                  />
                </td>
                <td>
                  <ComboInput
                    className="accounting-engine-combo"
                    value={row.owner_name || ''}
                    options={ownerOptions}
                    placeholder="담당자"
                    onChange={(value) => onUpdateRow?.(row, { owner_name: value })}
                  />
                </td>
              </tr>
            )
          ))}
          {!rows.length && <tr><td colSpan={isBank ? 10 : 8} className="empty-state">업로드된 내역이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
export function AccountingSessionHome() {
  const user = useAuthStore((state) => state.user);
  const canProfit = canAccessProfitLossReportForUser(user);
  return (
    <div className="page accounting-session-page">
      <div className="page-header">
        <div>
          <h2>통합회계 흐름</h2>
          <p className="management-support-subtitle">원천자료를 업로드하고 분류엔진에서 검토한 뒤 장부와 출력물로 연결합니다.</p>
        </div>
      </div>
      <AccountingWorkflowNav current="upload" />
      <div className="accounting-flow">
        <Link to="/accounting-session1/bank" className="accounting-flow-box input"><strong>거래내역 추가</strong><span>통장, 체크카드 원천자료 업로드</span></Link>
        <ArrowRight className="accounting-flow-arrow" />
        <Link to="/accounting-session1/engine" className="accounting-flow-box engine"><strong>분류 엔진</strong><span>계정, 지사, 증빙, 중복 검토</span></Link>
        <div className="accounting-flow-outputs">
          <Link to="/accounting-session2/reports/sales">실적/매출 장부</Link>
          <Link to="/accounting-session2/reports/expense">지출/거래 원장</Link>
          {canProfit && <Link to="/accounting-session2/reports/profit-loss">손익결산 자동 집계</Link>}
        </div>
      </div>
    </div>
  );
}

export function AccountingBankUpload() {
  return (
    <div className="page accounting-session-page">
      <div className="page-header"><div><h2>원천자료 업로드</h2><p className="management-support-subtitle">통장 거래내역과 체크카드 사용내역을 각각 업로드합니다.</p></div></div>
      <AccountingWorkflowNav current="upload" />
      <div className="accounting-upload-grid">
        <UploadBox kind="bank" title="통장 거래내역" />
        <UploadBox kind="checkCard" title="체크카드 사용내역" />
      </div>
    </div>
  );
}

export function AccountingCheckCardUpload() {
  const [cardRules, setCardRules] = useState<CardAssignmentRule[]>([]);
  const [keywordRules, setKeywordRules] = useState<MerchantKeywordRule[]>([]);
  const [ruleStatus, setRuleStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.accounting.checkCardRules()
      .then((result) => {
        if (cancelled) return;
        setCardRules((result.card_rules || []).map((rule) => ({
          id: String(rule.id || ''),
          last4: String(rule.card_last4 || ''),
          branch: String(rule.branch || ''),
          owner: String(rule.owner_name || ''),
          memo: String(rule.memo || ''),
        })));
        setKeywordRules((result.keyword_rules || []).map((rule) => ({
          id: String(rule.id || ''),
          keyword: String(rule.keyword || ''),
          category: String(rule.category || ''),
          item: String(rule.item || ''),
          memo: String(rule.memo || ''),
        })));
      })
      .catch((err: any) => setRuleStatus(err?.message || '규칙을 불러오지 못했습니다.'));
    return () => {
      cancelled = true;
    };
  }, []);

  const addCardRule = () => setCardRules([...cardRules, { id: `draft-card-${Date.now()}`, last4: '', branch: '의정부본사', owner: '', memo: '' }]);
  const addKeywordRule = () => setKeywordRules([...keywordRules, { id: `draft-keyword-${Date.now()}`, keyword: '', category: '', item: '', memo: '' }]);
  const patchCardRule = (id: string, patch: Partial<CardAssignmentRule>) => {
    setCardRules(cardRules.map((rule) => rule.id === id ? { ...rule, ...patch, last4: patch.last4 !== undefined ? patch.last4.replace(/\D/g, '').slice(-4) : rule.last4 } : rule));
  };
  const patchKeywordRule = (id: string, patch: Partial<MerchantKeywordRule>) => {
    setKeywordRules(keywordRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  };
  const saveCardRule = async (rule: CardAssignmentRule) => {
    if (rule.last4.length !== 4) {
      setRuleStatus('카드 뒷자리 4자리를 입력하세요.');
      return;
    }
    setRuleStatus('');
    const payload = { card_last4: rule.last4, branch: rule.branch, owner_name: rule.owner, memo: rule.memo };
    const result = rule.id.startsWith('draft-')
      ? await api.accounting.createCheckCardRule(payload)
      : await api.accounting.updateCheckCardRule(rule.id, payload);
    const saved = result.rule;
    setCardRules(cardRules.map((item) => item.id === rule.id ? {
      id: String(saved.id || rule.id),
      last4: String(saved.card_last4 || rule.last4),
      branch: String(saved.branch || rule.branch),
      owner: String(saved.owner_name || rule.owner),
      memo: String(saved.memo || rule.memo),
    } : item));
    setRuleStatus('카드 규칙이 저장되었습니다.');
  };
  const deleteCardRule = async (rule: CardAssignmentRule) => {
    if (!rule.id.startsWith('draft-')) await api.accounting.deleteCheckCardRule(rule.id);
    setCardRules(cardRules.filter((item) => item.id !== rule.id));
    setRuleStatus('카드 규칙이 삭제되었습니다.');
  };
  const saveKeywordRule = async (rule: MerchantKeywordRule) => {
    if (!rule.keyword.trim()) {
      setRuleStatus('가맹점 키워드를 입력하세요.');
      return;
    }
    setRuleStatus('');
    const payload = { keyword: rule.keyword, category: rule.category, item: rule.item, memo: rule.memo };
    const result = rule.id.startsWith('draft-')
      ? await api.accounting.createMerchantKeywordRule(payload)
      : await api.accounting.updateMerchantKeywordRule(rule.id, payload);
    const saved = result.rule;
    setKeywordRules(keywordRules.map((item) => item.id === rule.id ? {
      id: String(saved.id || rule.id),
      keyword: String(saved.keyword || rule.keyword),
      category: String(saved.category || rule.category),
      item: String(saved.item || rule.item),
      memo: String(saved.memo || rule.memo),
    } : item));
    setRuleStatus('키워드 규칙이 저장되었습니다.');
  };
  const deleteKeywordRule = async (rule: MerchantKeywordRule) => {
    if (!rule.id.startsWith('draft-')) await api.accounting.deleteMerchantKeywordRule(rule.id);
    setKeywordRules(keywordRules.filter((item) => item.id !== rule.id));
    setRuleStatus('키워드 규칙이 삭제되었습니다.');
  };

  return (
    <div className="page accounting-session-page">
      <div className="page-header">
        <div>
          <h2>체크카드 점검</h2>
          <p className="management-support-subtitle">엑셀 업로드는 원천자료 업로드에서만 진행하고, 이곳에서는 카드/키워드 자동분류 규칙만 관리합니다.</p>
        </div>
        <div className="accounting-edit-actions">
          <Link to="/accounting-session1/bank" className="btn">원천자료 업로드</Link>
          <Link to="/accounting-session1/engine" className="btn btn-primary">분류엔진 이동 <ArrowRight size={15} /></Link>
        </div>
      </div>
      <AccountingWorkflowNav current="check-card" />
      {ruleStatus && <div className={`accounting-auto-status ${ruleStatus.includes('입력') || ruleStatus.includes('못했습니다') ? 'warning' : ''}`}>{ruleStatus}</div>}
      <div className="accounting-check-card-rules-grid">
        <section className="card accounting-session2-card">
          <div className="accounting-edit-section-head">
            <div>
              <h3>이용카드 지사/담당자 등록</h3>
              <p>체크카드 엑셀의 카드번호 뒷자리 4자리로 지사와 담당자를 자동 지정합니다.</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={addCardRule}>+ 카드 추가</button>
          </div>
          <div className="table-wrap">
            <table className="data-table accounting-rule-table">
              <thead>
                <tr>
                  <th>카드 뒷자리</th>
                  <th>지사</th>
                  <th>담당자</th>
                  <th>메모</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cardRules.map((rule) => (
                  <tr key={rule.id}>
                    <td><input value={rule.last4} onChange={(event) => patchCardRule(rule.id, { last4: event.target.value })} placeholder="5900" inputMode="numeric" /></td>
                    <td>
                      <select value={rule.branch} onChange={(event) => patchCardRule(rule.id, { branch: event.target.value })}>
                        {BRANCH_OPTIONS.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                      </select>
                    </td>
                    <td><input value={rule.owner} onChange={(event) => patchCardRule(rule.id, { owner: event.target.value })} placeholder="담당자명" /></td>
                    <td><input value={rule.memo} onChange={(event) => patchCardRule(rule.id, { memo: event.target.value })} placeholder="메모" /></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => saveCardRule(rule)}>저장</button>
                        <button type="button" className="btn btn-sm" onClick={() => deleteCardRule(rule)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!cardRules.length && <tr><td colSpan={5} className="empty-state">등록된 카드 규칙이 없습니다. 카드 추가를 눌러 뒷자리 4자리를 등록하세요.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card accounting-session2-card">
          <div className="accounting-edit-section-head">
            <div>
              <div className="accounting-section-title-with-help">
                <h3>가맹점 키워드 자동분류</h3>
                <span className="accounting-keyword-help" tabIndex={0} aria-label="기본 등록 키워드 보기">
                  <HelpCircle size={16} />
                  <div className="accounting-keyword-tooltip" role="tooltip">
                    <strong>기본 자동분류 키워드</strong>
                    {DEFAULT_KEYWORD_GROUPS.map((group) => (
                      <div key={`${group.category}:${group.item}`} className="accounting-keyword-tooltip-group">
                        <b>{group.category} / {group.item}</b>
                        <span>{group.keywords.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </span>
              </div>
              <p>자주 쓰는 가맹점명을 분류/항목으로 미리 연결합니다. 애매한 건 분류엔진에서 수동 확인합니다.</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={addKeywordRule}>+ 키워드 추가</button>
          </div>
          <div className="table-wrap">
            <table className="data-table accounting-rule-table">
              <thead>
                <tr>
                  <th>가맹점 키워드</th>
                  <th>분류</th>
                  <th>항목</th>
                  <th>메모</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keywordRules.map((rule) => (
                  <tr key={rule.id}>
                    <td><input value={rule.keyword} onChange={(event) => patchKeywordRule(rule.id, { keyword: event.target.value })} placeholder="이명실 설렁탕" /></td>
                    <td><input value={rule.category} onChange={(event) => patchKeywordRule(rule.id, { category: event.target.value })} placeholder="기타" /></td>
                    <td><input value={rule.item} onChange={(event) => patchKeywordRule(rule.id, { item: event.target.value })} placeholder="식대" /></td>
                    <td><input value={rule.memo} onChange={(event) => patchKeywordRule(rule.id, { memo: event.target.value })} placeholder="메모" /></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => saveKeywordRule(rule)}>저장</button>
                        <button type="button" className="btn btn-sm" onClick={() => deleteKeywordRule(rule)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!keywordRules.length && <tr><td colSpan={5} className="empty-state">등록된 키워드 규칙이 없습니다. 키워드 추가를 눌러 자주 쓰는 가맹점을 등록하세요.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export function AccountingClassificationEngine() {
  const [session, setSession] = useState(readSession);
  const [kind, setKind] = useState<UploadKind>('bank');
  const [page, setPage] = useState(1);
  const [cardRules, setCardRules] = useState<CardAssignmentRule[]>([]);
  const [keywordRules, setKeywordRules] = useState<MerchantKeywordRule[]>([]);
  const [matchStatus, setMatchStatus] = useState('');
  const [autoMatchLog, setAutoMatchLog] = useState(readAutoMatchLog);
  const activeUpload = session[kind];
  const rows = activeUpload?.rows || [];
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const summary = useMemo(() => {
    const income = rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
    const expense = rows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.amount || 0))), 0);
    const missingCategory = rows.filter((row) => !row.category).length;
    const missingOwner = rows.filter((row) => !row.owner_name).length;
    return { income, expense, missingCategory, missingOwner };
  }, [rows]);
  const ownerOptions = useMemo(() => optionList([
    ...cardRules.map((rule) => rule.owner),
    ...(session.bank?.rows || []).map((row) => row.owner_name),
    ...(session.checkCard?.rows || []).map((row) => row.owner_name),
  ].map((value) => normalizeText(value)).filter(Boolean)), [cardRules, session]);

  useEffect(() => {
    let cancelled = false;
    api.accounting.checkCardRules()
      .then((result) => {
        if (cancelled) return;
        setCardRules((result.card_rules || []).map((rule) => ({
          id: String(rule.id || ''),
          last4: String(rule.card_last4 || ''),
          branch: String(rule.branch || ''),
          owner: String(rule.owner_name || ''),
          memo: String(rule.memo || ''),
        })));
        setKeywordRules((result.keyword_rules || []).map((rule) => ({
          id: String(rule.id || ''),
          keyword: String(rule.keyword || ''),
          category: String(rule.category || ''),
          item: String(rule.item || ''),
          memo: String(rule.memo || ''),
        })));
      })
      .catch(() => {
        if (!cancelled) setMatchStatus('카드/키워드 규칙을 불러오지 못했습니다. 저장된 업로드 자료만 표시합니다.');
      });
    return () => { cancelled = true; };
  }, []);

  const changeKind = (next: UploadKind) => {
    setKind(next);
    setPage(1);
  };

  const updateRow = (targetRow: any, patch: Record<string, string>) => {
    const upload = session[kind];
    if (!upload?.rows?.length) return;
    const targetKey = normalizeText(targetRow.source_key || targetRow.id);
    const nextRows = upload.rows.map((row) => {
      const rowKey = normalizeText(row.source_key || row.id);
      return rowKey && rowKey === targetKey ? { ...row, ...patch } : row;
    });
    const nextSession = {
      ...session,
      [kind]: {
        ...upload,
        rows: nextRows,
        sampleRows: nextRows.slice(0, 8),
      },
    } as Record<UploadKind, ParsedUpload | null>;
    setSession(nextSession);
    writeSession(nextSession);
  };

  const applyAutoMatch = () => {
    const upload = session[kind];
    if (!upload?.rows?.length) {
      setMatchStatus('자동 매칭할 업로드 내역이 없습니다.');
      return;
    }
    let cardMatched = 0;
    let keywordMatched = 0;
    const normalizedKeywordRules = [
      ...keywordRules.map((rule) => ({ category: rule.category, item: rule.item, keywords: [rule.keyword] })),
      ...DEFAULT_KEYWORD_GROUPS,
    ].filter((rule) => rule.category && rule.item && rule.keywords.some((keyword) => normalizeText(keyword)));

    const nextRows = upload.rows.map((row) => {
      const next = { ...row };
      const cardLast4 = normalizeText(next.card_last4).replace(/\D/g, '').slice(-4);
      const text = [next.merchant, next.merchant_name, next.description, next.counterparty, Array.isArray(next.raw) ? next.raw.join(' ') : next.raw]
        .map((value) => normalizeText(value).toLowerCase())
        .filter(Boolean)
        .join(' ');

      if (cardLast4) {
        const cardRule = cardRules.find((rule) => rule.last4 === cardLast4);
        if (cardRule) {
          if (!next.branch && cardRule.branch) next.branch = cardRule.branch;
          if (!next.owner_name && cardRule.owner) next.owner_name = cardRule.owner;
          cardMatched += 1;
        }
      }

      const keywordRule = normalizedKeywordRules.find((rule) => rule.keywords.some((keyword) => {
        const key = normalizeText(keyword).toLowerCase();
        return key && text.includes(key);
      }));
      if (keywordRule) {
        if (!next.category) next.category = keywordRule.category;
        if (!next.item) next.item = keywordRule.item;
        keywordMatched += 1;
      }
      return next;
    });

    const nextSession = {
      ...session,
      [kind]: {
        ...upload,
        rows: nextRows,
        sampleRows: nextRows.slice(0, 8),
        totalIncome: nextRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0),
        totalExpense: nextRows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.amount || 0))), 0),
      },
    } as Record<UploadKind, ParsedUpload | null>;
    setSession(nextSession);
    writeSession(nextSession);
    setPage(1);
    const matchedAt = formatKstDateTime();
    const nextLog = { ...autoMatchLog, [kind]: matchedAt };
    setAutoMatchLog(nextLog);
    writeAutoMatchLog(nextLog);
    setMatchStatus(`자동 매칭 완료: 카드 ${cardMatched.toLocaleString()}건, 키워드 ${keywordMatched.toLocaleString()}건을 반영했습니다. 마지막 자동 매칭: ${matchedAt} KST`);
  };

  return (
    <div className="page accounting-session-page">
      <div className="page-header">
        <div>
          <h2>분류엔진</h2>
          <p className="management-support-subtitle">통장 거래내역과 체크카드 사용내역을 한 화면에서 점검하고, 지사/담당자/분류/항목 누락을 확인합니다.</p>
        </div>
        <div className="accounting-edit-actions">
          <Link to="/accounting-session1/bank" className="btn">원천자료 업로드</Link>
          <Link to="/accounting-session1/check-card" className="btn">체크카드 점검</Link>
          <Link to="/accounting-session2" className="btn btn-primary">저장 반영 검토 <ArrowRight size={15} /></Link>
        </div>
      </div>
      <AccountingWorkflowNav current="engine" />
      {matchStatus && <div className={`accounting-auto-status ${matchStatus.includes('못했습니다') || matchStatus.includes('없습니다') ? 'warning' : ''}`}>{matchStatus}</div>}

      <div className="accounting-session2-kpis">
        <div className="card"><strong>{rows.length.toLocaleString()}건</strong><span>현재 검토 목록</span></div>
        <div className="card"><strong>{formatMoney(summary.income)}</strong><span>입금 합계</span></div>
        <div className="card warning"><strong>{formatMoney(summary.expense)}</strong><span>출금/카드 합계</span></div>
        <div className={summary.missingCategory || summary.missingOwner ? 'card danger' : 'card'}>
          <strong>{(summary.missingCategory + summary.missingOwner).toLocaleString()}건</strong>
          <span>분류/담당자 확인 필요</span>
        </div>
      </div>

      <section className="card accounting-session2-card accounting-engine-review-card">
        <div className="accounting-edit-section-head">
          <div>
            <h3>{kind === 'bank' ? '통장거래내역 수정' : '체크카드 수정'}</h3>
            <p>{kind === 'bank' ? '입/출금 금액, 거래처, 업무성과 매칭 결과를 기준으로 분류를 점검합니다.' : '카드 뒷자리, 가맹점, 카드 등록 규칙을 기준으로 지사와 담당자를 점검합니다.'}</p>
          </div>
          <div className="accounting-edit-actions">
            <span>{activeUpload?.fileName || '업로드 전'}</span>
            {autoMatchLog[kind] && <span className="accounting-auto-match-log">마지막 자동 매칭 {autoMatchLog[kind]} KST</span>}
            <button type="button" className="btn btn-sm btn-primary" onClick={applyAutoMatch}>자동 매칭</button>
          </div>
        </div>
        <div className="accounting-edit-tabs">
          <button type="button" className={kind === 'bank' ? 'active' : ''} onClick={() => changeKind('bank')}>통장 거래내역 <span>{(session.bank?.rows.length || 0).toLocaleString()}</span></button>
          <button type="button" className={kind === 'checkCard' ? 'active' : ''} onClick={() => changeKind('checkCard')}>체크카드 수정 <span>{(session.checkCard?.rows.length || 0).toLocaleString()}</span></button>
        </div>
        {rows.length ? (
          <>
            <PreviewTable rows={pageRows} ownerOptions={ownerOptions} onUpdateRow={updateRow} />
            <div className="accounting-pagination">
              <button type="button" className="btn btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
                const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                const pageNumber = start + index;
                if (pageNumber > totalPages) return null;
                return (
                  <button key={pageNumber} type="button" className={`btn btn-sm ${pageNumber === currentPage ? 'btn-primary' : ''}`} onClick={() => setPage(pageNumber)}>
                    {pageNumber}
                  </button>
                );
              })}
              <button type="button" className="btn btn-sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>다음</button>
              <span>{currentPage} / {totalPages} 페이지</span>
            </div>
          </>
        ) : (
          <div className="accounting-engine-empty">
            <strong>{kind === 'bank' ? '통장 거래내역이 아직 없습니다.' : '체크카드 사용내역이 아직 없습니다.'}</strong>
            <span>먼저 원천자료 업로드에서 엑셀을 넣으면 이곳에서 분류와 담당자 점검 목록이 표시됩니다.</span>
            <Link to="/accounting-session1/bank" className="btn btn-primary">거래내역 추가</Link>
          </div>
        )}
      </section>
    </div>
  );
}
export function AccountingSessionRules() {
  return (
    <div className="page accounting-session-page">
      <div className="page-header"><div><h2>이용카드 / 키워드 규칙</h2><p className="management-support-subtitle">카드 뒷자리, 지사, 담당자, 자주 쓰는 가맹점 키워드 규칙을 관리하는 영역입니다.</p></div></div>
      <AccountingWorkflowNav current="engine" />
      <section className="card accounting-session2-card">
        <h3>운영 메모</h3>
        <p>카드번호 뒷자리 4자리와 가맹점 키워드 기준으로 자동분류를 적용하고, 애매한 건은 분류엔진에서 수동 확인합니다.</p>
      </section>
    </div>
  );
}

export function AccountingSessionTwo() {
  const user = useAuthStore((state) => state.user);
  const [session] = useState(readSession);
  const outputCards = [
    { title: '실적/매출 장부', desc: '매출 분류 내역 출력', path: '/accounting-session2/reports/sales' },
    { title: '지출/거래 원장', desc: '지출 원장 출력', path: '/accounting-session2/reports/expense' },
    { title: '손익결산', desc: '월별 손익결산 출력', path: '/accounting-session2/reports/profit-loss' },
    { title: '인건비 통합', desc: '직원관리 고정급 인원 총액', path: '/accounting-session2/reports/labor-cost', restricted: true },
    { title: '체크카드 사용내역', desc: '체크카드 원천 출력', path: '/accounting-session2/reports/check-card' },
    { title: '세무자료', desc: '세무 대상 지출 출력', path: '/accounting-session2/reports/tax' },
    { title: '검토로그', desc: '업로드와 중복 검토 기록', path: '/accounting-session2/reports/audit' },
  ].filter((card) => {
    if (card.path.includes('/profit-loss')) return canAccessProfitLossReportForUser(user);
    return !card.restricted || canAccessLaborCostReportForUser(user);
  });
  const rows = [...(session.bank?.rows || []), ...(session.checkCard?.rows || [])];
  return (
    <div className="page accounting-session-page">
      <div className="page-header"><div><h2>저장 반영 검토</h2><p className="management-support-subtitle">분류엔진에서 정리한 원천자료를 장부 반영 전 최종 확인합니다.</p></div></div>
      <AccountingWorkflowNav current="review" />
      <div className="accounting-session2-kpis">
        <div className="card"><strong>{rows.length.toLocaleString()}건</strong><span>검토 대상</span></div>
        <div className="card warning"><strong>{rows.filter((row) => !row.category).length.toLocaleString()}건</strong><span>미분류</span></div>
        <div className="card"><strong>{formatMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong><span>순액</span></div>
      </div>
      <PreviewTable rows={rows.slice(0, 50)} />
      <h3 className="section-title">출력물</h3>
      <div className="accounting-output-grid">
        {outputCards.map((card) => <Link key={card.path} to={card.path} className="accounting-output-card"><strong>{card.title}</strong><span>{card.desc}</span></Link>)}
      </div>
    </div>
  );
}

export function AccountingReportsHub() {
  const user = useAuthStore((state) => state.user);
  const reportKinds = getVisibleAccountingReportKinds(user);
  return (
    <div className="page accounting-session-page">
      <div className="page-header"><div><h2>출력물</h2><p className="management-support-subtitle">확정 저장된 통합회계 데이터를 출력물별로 확인합니다.</p></div></div>
      <AccountingWorkflowNav current="reports" />
      <div className="accounting-output-grid accounting-report-hub-grid">
        {reportKinds.map((kind) => {
          const meta = ACCOUNTING_REPORT_META[kind];
          return <Link key={kind} to={meta.path} className="accounting-output-card"><strong>{meta.title}</strong><span>{meta.desc}</span><em><FileDown size={13} /> 장부 확인</em></Link>;
        })}
        {canAccessForecastReportForUser(user) && <Link to="/accounting-session2/reports/forecast" className="accounting-output-card confidential"><strong>다음달 예상 손익</strong><span>매출과 반복 지출 패턴으로 다음달 손익을 예측합니다.</span></Link>}
        {canAccessLaborCostReportForUser(user) && <Link to="/accounting-session2/reports/labor-cost" className="accounting-output-card confidential"><strong>인건비 통합</strong><span>직원관리 고정급 인원을 지사, 팀, 직급 순으로 확인합니다.</span></Link>}
      </div>
    </div>
  );
}

export function AccountingSalesLedgerReport() {
  return <AccountingLedgerReportPage reportType="sales" />;
}

export function AccountingExpenseLedgerReport() {
  return <AccountingLedgerReportPage reportType="expense" />;
}

export function AccountingProfitLossReport() {
  return <AccountingLedgerReportPage reportType="profit-loss" />;
}

export function AccountingCheckCardReport() {
  return <AccountingLedgerReportPage reportType="check-card" />;
}

export function AccountingTaxReport() {
  return <AccountingLedgerReportPage reportType="tax" />;
}

export function AccountingAuditReport() {
  return <AccountingLedgerReportPage reportType="audit" />;
}

export function AccountingForecastReport() {
  return <AccountingForecastPage />;
}

function AccountingLedgerReportPage({ reportType }: { reportType: AccountingReportKind }) {
  const meta = ACCOUNTING_REPORT_META[reportType];
  const user = useAuthStore((state) => state.user);
  const isScopedAsst = user?.role === 'accountant_asst';
  const asstBranch = isScopedAsst && isAccountingAsstAllowedBranch(user) ? (user?.branch || '') : '';
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState(searchParams.get('month') || 'latest');
  const [branch, setBranch] = useState(isScopedAsst ? asstBranch : (searchParams.get('branch') || '전체'));
  const [data, setData] = useState<{ rows: any[]; summary: any; months: string[]; latest_import?: any }>({ rows: [], summary: {}, months: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isScopedAsst) {
      setBranch(asstBranch);
      return;
    }
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (branch && branch !== '전체') params.set('branch', branch);
    setSearchParams(params, { replace: true });
  }, [asstBranch, branch, isScopedAsst, month, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.accounting.session2Report({ report_type: reportType, month, branch: branch === '전체' ? undefined : branch })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || '출력물을 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branch, month, reportType]);

  const columns = useMemo(() => getReportColumns(reportType), [reportType]);
  const summary = data.summary || {};
  if (isScopedAsst && !asstBranch) {
    return (
      <div className="page accounting-session-page accounting-report-page">
        <div className="page-header">
          <div><h2>{meta.title}</h2><p className="management-support-subtitle">총무보조는 의정부 본사 및 종합 지표를 열람할 수 없습니다.</p></div>
        </div>
      </div>
    );
  }
  return (
    <div className={`page accounting-session-page accounting-report-page accounting-report-${reportType}`}>
      <div className="page-header">
        <div><h2>{meta.title}</h2><p className="management-support-subtitle">{meta.desc}</p></div>
        <div className="accounting-edit-actions"><Link to="/accounting-session2/reports" className="btn">출력물</Link><button type="button" className="btn" onClick={() => window.print()}><Printer size={15} /> PDF/프린트</button></div>
      </div>
      <AccountingWorkflowNav current="reports" />
      {error && <div className="accounting-auto-status warning">{error}</div>}
      <div className="accounting-report-tabs">
        {Object.entries(ACCOUNTING_REPORT_META)
          .filter(([kind]) => kind !== 'profit-loss' || canAccessProfitLossReportForUser(user))
          .map(([kind, item]) => <Link key={kind} to={item.path} className={kind === reportType ? 'active' : ''}>{item.title}</Link>)}
      </div>
      <div className="accounting-report-filters">
        <select value={month} onChange={(event) => setMonth(event.target.value)}>
          <option value="latest">최신달</option>
          <option value="all">전체</option>
          {(data.months || []).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={branch} onChange={(event) => setBranch(event.target.value)} disabled={isScopedAsst}>
          {REPORT_BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
          {isScopedAsst && asstBranch && !REPORT_BRANCHES.includes(asstBranch) && <option value={asstBranch}>{asstBranch}</option>}
        </select>
      </div>
      <section className="accounting-session2-kpis accounting-report-kpis">
        <div className="card"><strong>{(summary.total_count || data.rows.length || 0).toLocaleString()}건</strong><span>총 건수</span></div>
        <div className="card"><strong>{formatMoney(summary.total_income || summary.sales_total || 0)}</strong><span>수입</span></div>
        <div className="card warning"><strong>{formatMoney(summary.total_expense || summary.expense_total || 0)}</strong><span>지출</span></div>
        <div className="card"><strong>{formatMoney(summary.net_profit || summary.net_total || 0)}</strong><span>순액</span></div>
      </section>
      {loading ? <div className="empty-state">불러오는 중입니다.</div> : (
        <div className="table-wrap">
          <table className="data-table accounting-report-table">
            <thead><tr>{columns.map((column) => <th key={column.key} className={column.numeric ? 'report-number' : ''}>{column.label}</th>)}</tr></thead>
            <tbody>
              {(data.rows || []).map((row, index) => (
                <tr key={row.id || index}>
                  {columns.map((column) => <td key={column.key} className={column.numeric ? 'report-number' : ''} title={normalizeText(row[column.key])}>{column.numeric ? formatMoney(row[column.key], '') : normalizeText(row[column.key]) || '-'}</td>)}
                </tr>
              ))}
              {!data.rows?.length && <tr><td colSpan={columns.length} className="empty-state">출력할 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountingForecastPage() {
  return (
    <div className="page accounting-session-page accounting-report-page">
      <div className="page-header"><div><h2>다음달 예상 손익</h2><p className="management-support-subtitle">예상 손익은 확정 장부와 반복 지출을 기준으로 별도 정교화 예정입니다.</p></div></div>
      <AccountingWorkflowNav current="reports" />
      <section className="card accounting-session2-card"><p>현재는 손익결산 출력물을 기준으로 확인해 주세요.</p></section>
    </div>
  );
}

export function AccountingLaborCostReport() {
  const currentUser = useAuthStore((state) => state.user);
  const [data, setData] = useState<{ rows: any[]; summary: any }>({ rows: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.accounting.laborCostReport()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || '인건비 통합 데이터를 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const groups = getLaborCostBranchGroups(data.rows || []);
  const summary = data.summary || {};
  return (
    <div className="page accounting-session-page accounting-report-page accounting-labor-cost-page">
      <div className="page-header">
        <div><h2>인건비 통합</h2><p className="management-support-subtitle">직원관리의 고정급 인원을 지사, 팀, 직급 순으로 정리합니다.</p></div>
        <div className="accounting-edit-actions"><Link to="/accounting-session2/reports" className="btn">출력물</Link><button type="button" className="btn" onClick={() => window.print()}><Printer size={15} /> PDF/프린트</button></div>
      </div>
      <AccountingWorkflowNav current="reports" />
      {error && <div className="accounting-auto-status warning">{error}</div>}
      <section className="accounting-session2-kpis accounting-report-kpis">
        <div className="card"><strong>{Number(summary.staff_count || 0).toLocaleString()}명</strong><span>고정급 인원</span></div>
        <div className="card warning"><strong>{formatMoney(summary.total_salary || 0)}</strong><span>급여 합계</span></div>
        <div className="card"><strong>{formatMoney(summary.total_allowance || 0)}</strong><span>직급수당 합계</span></div>
        <div className="card warning"><strong>{formatMoney(summary.total_labor_cost || 0)}</strong><span>총 인건비</span></div>
      </section>
      <section className="card accounting-session2-card accounting-labor-cost-sheet">
        <div className="accounting-labor-cost-head">
          <div><strong>인건비 통합</strong><span>직원관리 기준 · {currentUser?.name || ''}</span></div>
          <b>{formatMoney(summary.total_labor_cost || 0)}</b>
        </div>
        {loading && <div className="empty-state">불러오는 중입니다.</div>}
        {!loading && groups.map((branch) => (
          <div key={branch.branchKey} className="accounting-labor-branch">
            <div className="accounting-labor-branch-title"><span>{branch.branch}</span><strong>{branch.staffCount.toLocaleString()}명 · {formatMoney(branch.total)}</strong></div>
            {branch.teams.map((team) => (
              <div key={`${branch.branchKey}:${team.department}`} className="accounting-labor-team">
                <div className="accounting-labor-team-title"><span>{team.department}</span><strong>{team.staffCount.toLocaleString()}명 · {formatMoney(team.total)}</strong></div>
                <table className="data-table accounting-labor-table">
                  <thead><tr><th>직급</th><th>이름</th><th>급여</th><th>직급수당</th><th>합계</th></tr></thead>
                  <tbody>{team.rows.map((row) => <tr key={row.user_id}><td>{row.position_title || row.grade || '-'}</td><td>{row.name}</td><td>{formatMoney(row.salary, '')}</td><td>{formatMoney(row.position_allowance, '')}</td><td>{formatMoney(row.total, '')}</td></tr>)}</tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
        {!loading && !groups.length && <div className="empty-state">출력할 고정급 인건비 데이터가 없습니다.</div>}
      </section>
    </div>
  );
}

function getLaborCostBranchGroups(rows: any[]) {
  const branchOrder = ['의정부본사', '서초', '대전', '부산', '본사관리'];
  const positionOrder = ['대표', '지사장', '본부장', '이사', '팀장', '부장', '차장', '과장', '대리', '주임', '사원'];
  const branchMap = new Map<string, Map<string, any[]>>();
  rows.forEach((row) => {
    const branch = normalizeReportBranch(row.branch) || '미지정';
    const department = normalizeText(row.department) || '미지정';
    if (!branchMap.has(branch)) branchMap.set(branch, new Map());
    const teamMap = branchMap.get(branch)!;
    if (!teamMap.has(department)) teamMap.set(department, []);
    teamMap.get(department)!.push({ ...row, branch, department, total: Number(row.total || 0) });
  });
  const branchRank = (branch: string) => {
    const index = branchOrder.indexOf(branch);
    return index === -1 ? 999 : index;
  };
  const positionRank = (row: any) => {
    const label = normalizeText(row.position_title || row.grade);
    const index = positionOrder.findIndex((item) => label.includes(item));
    return index === -1 ? 999 : index;
  };
  return Array.from(branchMap.entries())
    .sort(([a], [b]) => branchRank(a) - branchRank(b) || a.localeCompare(b, 'ko'))
    .map(([branchKey, teamMap]) => {
      const teams = Array.from(teamMap.entries()).map(([department, teamRows]) => {
        const sortedRows = [...teamRows].sort((a, b) => positionRank(a) - positionRank(b) || normalizeText(a.name).localeCompare(normalizeText(b.name), 'ko'));
        return { department, rows: sortedRows, total: sortedRows.reduce((sum, row) => sum + Number(row.total || 0), 0), staffCount: sortedRows.length };
      });
      return {
        branchKey,
        branch: branchKey === '서초' ? '서초지사' : branchKey === '대전' ? '대전지사' : branchKey === '부산' ? '부산지사' : branchKey,
        teams,
        total: teams.reduce((sum, team) => sum + team.total, 0),
        staffCount: teams.reduce((sum, team) => sum + team.staffCount, 0),
      };
    });
}

function getReportColumns(reportType: AccountingReportKind) {
  if (reportType === 'profit-loss') {
    return [
      { key: 'branch', label: '지사' },
      { key: 'income_total', label: '총수입 합계', numeric: true },
      { key: 'expense_total', label: '총지출 합계', numeric: true },
      { key: 'net_profit', label: '최종순익', numeric: true },
    ];
  }
  if (reportType === 'audit') {
    return [
      { key: 'source_type', label: '원천' },
      { key: 'source_key', label: '키' },
      { key: 'status', label: '상태' },
      { key: 'memo', label: '메모' },
      { key: 'created_at', label: '기록일' },
    ];
  }
  return [
    { key: 'date', label: '일자' },
    { key: 'branch', label: '지사' },
    { key: 'owner_name', label: '담당자' },
    { key: 'category', label: '분류' },
    { key: 'item', label: '항목' },
    { key: 'description', label: '내용' },
    { key: 'amount', label: '금액', numeric: true },
    { key: 'source_type', label: '원천' },
  ];
}
