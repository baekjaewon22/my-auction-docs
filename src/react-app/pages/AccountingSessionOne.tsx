import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, FileDown, HelpCircle, Printer, UploadCloud } from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { CANONICAL_BRANCHES, isRestrictedAccountingBranch, normalizeBranchName } from '../lib/branchAliases';

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
const REPORT_BRANCHES = ['전체', ...CANONICAL_BRANCHES];
const BRANCH_OPTIONS = [...CANONICAL_BRANCHES];

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

function normalizeCardLast4(value: unknown) {
  return String(value || '').replace(/\D/g, '').slice(-4);
}

function shrinkSessionRow(row: any) {
  return {
    id: row.id,
    source_type: row.source_type,
    source_key: row.source_key,
    date: row.date,
    transaction_at: row.transaction_at,
    transaction_type: row.transaction_type,
    direction: row.direction,
    amount: row.amount,
    balance: row.balance,
    description: row.description,
    counterparty: row.counterparty,
    merchant: row.merchant,
    merchant_name: row.merchant_name,
    card_last4: normalizeCardLast4(row.card_last4 || row.card_number),
    branch: row.branch,
    owner_name: row.owner_name,
    category: row.category,
    item: row.item,
    memo: row.memo,
    ledger_policy: row.ledger_policy,
    complete: row.complete,
    duplicate: row.duplicate,
    duplicate_status: row.duplicate_status,
  };
}

function shrinkSessionUpload(upload: ParsedUpload | null): ParsedUpload | null {
  if (!upload) return null;
  const rows = (upload.rows || []).map(shrinkSessionRow);
  return {
    ...upload,
    rows,
    sampleRows: rows.slice(0, 8),
  };
}

function shrinkSession(session: Record<UploadKind, ParsedUpload | null>) {
  return {
    bank: shrinkSessionUpload(session.bank),
    checkCard: shrinkSessionUpload(session.checkCard),
  };
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

function SelectInput({
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
  return (
    <select className={className} value={value || ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {optionList(options, value).map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
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
  const compact = shrinkSession(session);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(compact));
  } catch {
    const fallback = {
      bank: compact.bank ? { ...compact.bank, rows: compact.bank.rows.slice(0, 500), sampleRows: compact.bank.sampleRows.slice(0, 8) } : null,
      checkCard: compact.checkCard ? { ...compact.checkCard, rows: compact.checkCard.rows.slice(0, 500), sampleRows: compact.checkCard.sampleRows.slice(0, 8) } : null,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(fallback));
  }
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

function isRestrictedBranchForAccountingAsst(branch: unknown): boolean {
  return isRestrictedAccountingBranch(branch);
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

function canAccessTaxMaterialsForUser(user?: { role?: string } | null) {
  return !!user && ['master', 'ceo', 'accountant'].includes(user.role || '');
}

function normalizeReportBranch(value: unknown) {
  return normalizeBranchName(value);
}

function getVisibleAccountingReportKinds(user?: { id?: string; role?: string } | null): AccountingReportKind[] {
  return (Object.keys(ACCOUNTING_REPORT_META) as AccountingReportKind[])
    .filter((kind) => kind !== 'profit-loss' || canAccessProfitLossReportForUser(user))
    .filter((kind) => kind !== 'tax' || canAccessTaxMaterialsForUser(user));
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
                  <SelectInput
                    className={`accounting-engine-combo ${!row.category ? 'field-warning' : ''}`}
                    value={row.category || ''}
                    options={ACCOUNTING_CATEGORY_OPTIONS}
                    placeholder="분류"
                    onChange={(value) => onUpdateRow?.(row, { category: value, item: '' })}
                  />
                </td>
                <td>
                  <SelectInput
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
                <td>{row.card_last4 || '-'}</td>
                <td title={normalizeText(row.merchant || row.description)}>{row.merchant || row.description || '-'}</td>
                <td className="report-number">{formatSignedMoney(row.amount)}</td>
                <td>
                  <SelectInput
                    className={`accounting-engine-combo ${!row.category ? 'field-warning' : ''}`}
                    value={row.category || ''}
                    options={ACCOUNTING_CATEGORY_OPTIONS}
                    placeholder="분류"
                    onChange={(value) => onUpdateRow?.(row, { category: value, item: '' })}
                  />
                </td>
                <td>
                  <SelectInput
                    className={`accounting-engine-combo ${!row.item ? 'field-warning' : ''}`}
                    value={row.item || ''}
                    options={getItemOptions(row.category, row.item)}
                    placeholder="항목"
                    onChange={(value) => onUpdateRow?.(row, { item: value })}
                  />
                </td>
                <td>
                  <SelectInput
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
    if (card.path.includes('/reports/tax')) return canAccessTaxMaterialsForUser(user);
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
  const canEditLedgerRows = reportType === 'expense' && ['master', 'ceo', 'accountant', 'accountant_asst'].includes(user?.role || '');
  const isScopedAsst = user?.role === 'accountant_asst';
  const asstBranch = isScopedAsst && isAccountingAsstAllowedBranch(user) ? (user?.branch || '') : '';
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState(searchParams.get('month') || 'latest');
  const [branch, setBranch] = useState(isScopedAsst ? asstBranch : (searchParams.get('branch') || '전체'));
  const [data, setData] = useState<{ rows: any[]; summary: any; months: string[]; latest_import?: any; profit_loss_statement?: any }>({ rows: [], summary: {}, months: [] });
  const [editableRows, setEditableRows] = useState<any[]>([]);
  const [savingLedgerId, setSavingLedgerId] = useState('');
  const [editingLedgerCell, setEditingLedgerCell] = useState('');
  const [dirtyLedgerIds, setDirtyLedgerIds] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
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
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setEditableRows(result.rows || []);
        setDirtyLedgerIds([]);
        setEditingLedgerCell('');
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || '출력물을 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branch, month, reportType, reloadKey]);

  const columns = useMemo(() => getReportColumns(reportType), [reportType]);
  const summary = data.summary || {};
  const displayRows = canEditLedgerRows ? editableRows : (data.rows || []);
  const patchLedgerRow = (id: string, patch: Record<string, unknown>) => {
    setEditableRows((rows) => rows.map((row) => String(row.id) === id ? { ...row, ...patch } : row));
  };
  const addLedgerRow = () => {
    const baseMonth = /^\d{4}-\d{2}$/.test(month) ? month : '';
    setEditableRows((rows) => [{
      id: `draft:${Date.now()}`,
      ledger_type: 'expense',
      entry_date: baseMonth ? `${baseMonth}-01` : '',
      branch: branch !== '?꾩껜' ? branch : '',
      owner_name: '',
      category: '',
      item: '',
      amount: 0,
      direction: 'expense',
      memo: '',
      description: '',
      ledger_policy: '지출원장',
      source_type: 'bank',
      card_last4: '',
    }, ...rows]);
    setEditStatus('새 행을 추가했습니다. 내용을 입력한 뒤 저장해주세요.');
  };
  const saveLedgerRow = async (row: any) => {
    const id = String(row.id);
    setSavingLedgerId(id);
    setEditStatus('');
    try {
      const payload = {
        entry_date: row.entry_date,
        branch: row.branch,
        owner_name: row.owner_name,
        category: row.category,
        item: row.item,
        amount: Number(row.amount || 0),
        memo: row.memo,
        description: row.description,
        merchant_name: row.merchant_name,
        card_last4: row.card_last4,
        ledger_policy: row.ledger_policy,
        source_type: row.source_type === 'checkCard' ? 'checkCard' : 'bank',
        ledger_type: row.ledger_type === 'expense_refund' ? 'expense_refund' : 'expense',
      };
      if (id.startsWith('draft:')) await api.accounting.createSession2LedgerRow(payload);
      else await api.accounting.updateSession2LedgerRow(id, payload);
      setEditStatus('저장했습니다.');
      setReloadKey((value) => value + 1);
    } catch (err: any) {
      setEditStatus(err?.message || '저장하지 못했습니다.');
    } finally {
      setSavingLedgerId('');
    }
  };
  void [patchLedgerRow, addLedgerRow, saveLedgerRow];
  const deleteLedgerRow = async (row: any) => {
    const id = String(row.id);
    if (!window.confirm('이 원장 행을 삭제할까요?')) return;
    if (id.startsWith('draft:')) {
      setEditableRows((rows) => rows.filter((item) => String(item.id) !== id));
      return;
    }
    setSavingLedgerId(id);
    setEditStatus('');
    try {
      await api.accounting.deleteSession2LedgerRow(id);
      setEditStatus('삭제했습니다.');
      setReloadKey((value) => value + 1);
    } catch (err: any) {
      setEditStatus(err?.message || '삭제하지 못했습니다.');
    } finally {
      setSavingLedgerId('');
    }
  };
  const markLedgerRowDirty = (id: string) => {
    setDirtyLedgerIds((ids) => ids.includes(id) ? ids : [...ids, id]);
  };
  const patchLedgerCell = (id: string, patch: Record<string, unknown>) => {
    setEditableRows((rows) => rows.map((row) => String(row.id) === id ? { ...row, ...patch } : row));
    markLedgerRowDirty(id);
  };
  const buildLedgerPayload = (row: any) => ({
    entry_date: row.entry_date,
    branch: row.branch,
    owner_name: row.owner_name,
    category: row.category,
    item: row.item,
    amount: Number(row.amount || 0),
    memo: row.memo,
    description: row.description,
    merchant_name: row.merchant_name,
    card_last4: normalizeCardLast4(row.card_last4),
    ledger_policy: row.ledger_policy,
    source_type: row.source_type === 'checkCard' ? 'checkCard' : 'bank',
    ledger_type: row.ledger_type === 'expense_refund' ? 'expense_refund' : 'expense',
  });
  const saveAllLedgerRows = async () => {
    const rowsToSave = editableRows.filter((row) => {
      const id = String(row.id);
      return id.startsWith('draft:') || dirtyLedgerIds.includes(id);
    });
    if (!rowsToSave.length) {
      setEditStatus('저장할 변경사항이 없습니다.');
      return;
    }
    setSavingLedgerId('all');
    setEditStatus('');
    try {
      for (const row of rowsToSave) {
        const id = String(row.id);
        const payload = buildLedgerPayload(row);
        if (id.startsWith('draft:')) await api.accounting.createSession2LedgerRow(payload);
        else await api.accounting.updateSession2LedgerRow(id, payload);
      }
      setEditStatus(`${rowsToSave.length.toLocaleString()}개 행을 저장했습니다.`);
      setReloadKey((value) => value + 1);
    } catch (err: any) {
      setEditStatus(err?.message || '저장하지 못했습니다.');
    } finally {
      setSavingLedgerId('');
    }
  };
  const addLedgerRowForBulkEdit = () => {
    const baseMonth = /^\d{4}-\d{2}$/.test(month) ? month : '';
    const id = `draft:${Date.now()}`;
    setEditableRows((rows) => [{
      id,
      ledger_type: 'expense',
      entry_date: baseMonth ? `${baseMonth}-01` : '',
      branch: REPORT_BRANCHES.includes(branch) && branch !== REPORT_BRANCHES[0] ? branch : '',
      owner_name: '',
      category: '',
      item: '',
      amount: 0,
      direction: 'expense',
      memo: '',
      description: '',
      ledger_policy: 'bank',
      source_type: 'bank',
      card_last4: '',
    }, ...rows]);
    setDirtyLedgerIds((ids) => [...ids, id]);
    setEditingLedgerCell(`${id}:entry_date`);
    setEditStatus('새 행을 추가했습니다. 내용을 입력한 뒤 전체 저장을 눌러주세요.');
  };
  const renderLedgerCell = (row: any, column: { key: string; numeric?: boolean }) => {
    const rowId = String(row.id);
    const cellKey = `${rowId}:${column.key}`;
    const isEditing = editingLedgerCell === cellKey || rowId.startsWith('draft:');
    const requiredEmpty = reportType === 'expense' && isRequiredExpenseLedgerCellEmpty(row, column);
    const inputClassName = `accounting-ledger-cell-input ${requiredEmpty ? 'is-required-empty' : ''}`;
    const update = (value: string) => patchLedgerCell(rowId, { [column.key]: column.key === 'card_last4' ? normalizeCardLast4(value) : value });
    if (!isEditing) {
      return (
        <span className={`accounting-ledger-cell-display ${requiredEmpty ? 'is-required-empty' : ''}`} role="button" tabIndex={0} onClick={() => setEditingLedgerCell(cellKey)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setEditingLedgerCell(cellKey); }} title={getReportCellTitle(row, column)}>
          {column.numeric ? formatMoney(row[column.key], '') : (getReportCellText(row, column) || '-')}
        </span>
      );
    }
    if (column.numeric) {
      return <input className={`${inputClassName} number`} type="number" value={Number(row[column.key] || 0)} onChange={(event) => update(event.target.value)} onBlur={() => setEditingLedgerCell('')} />;
    }
    if (column.key === 'entry_date') {
      return <input className={inputClassName} type="date" value={String(row.entry_date || '').slice(0, 10)} onChange={(event) => patchLedgerCell(rowId, { entry_date: event.target.value })} onBlur={() => setEditingLedgerCell('')} />;
    }
    if (column.key === 'branch') {
      return <SelectInput className={inputClassName} value={row.branch || ''} options={BRANCH_OPTIONS} placeholder="지사" onChange={(value) => patchLedgerCell(rowId, { branch: value })} />;
    }
    if (column.key === 'category') {
      return <SelectInput className={inputClassName} value={row.category || ''} options={ACCOUNTING_CATEGORY_OPTIONS} placeholder="분류" onChange={(value) => patchLedgerCell(rowId, { category: value, item: '' })} />;
    }
    if (column.key === 'item') {
      return <SelectInput className={inputClassName} value={row.item || ''} options={getItemOptions(row.category, row.item)} placeholder="항목" onChange={(value) => patchLedgerCell(rowId, { item: value })} />;
    }
    if (column.key === 'ledger_policy') {
      return (
        <select className={inputClassName} value={row.source_type === 'checkCard' ? 'checkCard' : 'bank'} onChange={(event) => patchLedgerCell(rowId, { source_type: event.target.value, ledger_policy: event.target.value })}>
          <option value="bank">계좌이체</option>
          <option value="checkCard">체크카드</option>
        </select>
      );
    }
    return <input className={inputClassName} value={getReportCellText(row, column)} onChange={(event) => update(event.target.value)} onBlur={() => setEditingLedgerCell('')} />;
  };
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
      {editStatus && <div className={`accounting-auto-status ${editStatus.includes('못했습니다') ? 'warning' : ''}`}>{editStatus}</div>}
      {canEditLedgerRows && (
        <div className="accounting-ledger-edit-toolbar">
          <button type="button" className="btn btn-primary" onClick={addLedgerRowForBulkEdit}>행 추가</button>
          <button type="button" className="btn" disabled={savingLedgerId === 'all'} onClick={saveAllLedgerRows}>전체 저장</button>
          <span>엑셀 기반 지출/거래 원장 행을 추가, 수정, 삭제할 수 있습니다.</span>
        </div>
      )}
      <div className="accounting-report-tabs">
        {Object.entries(ACCOUNTING_REPORT_META)
          .filter(([kind]) => kind !== 'profit-loss' || canAccessProfitLossReportForUser(user))
          .filter(([kind]) => kind !== 'tax' || canAccessTaxMaterialsForUser(user))
          .map(([kind, item]) => <Link key={kind} to={item.path} className={kind === reportType ? 'active' : ''}>{item.title}</Link>)}
      </div>
      <div className="accounting-report-filters">
        <select value={month} onChange={(event) => setMonth(event.target.value)}>
          <option value="latest">완료된 전달</option>
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
      {loading ? <div className="empty-state">불러오는 중입니다.</div> : reportType === 'profit-loss' ? (
        <ProfitLossStatementView statement={data.profit_loss_statement} />
      ) : (
        <div className="table-wrap">
          <table className="data-table accounting-report-table">
            <thead><tr>{columns.map((column) => <th key={column.key} className={column.numeric ? 'report-number' : ''}>{column.label}</th>)}{canEditLedgerRows && <th>관리</th>}</tr></thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr key={row.id || index}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`${column.numeric ? 'report-number' : 'accounting-report-cell-text'} ${reportType === 'expense' && isRequiredExpenseLedgerCellEmpty(row, column) ? 'accounting-ledger-required-empty' : ''}`}
                      title={getReportCellTitle(row, column)}
                    >
                      {canEditLedgerRows ? renderLedgerCell(row, column) : (
                        column.numeric ? formatMoney(row[column.key], '') : <span className="accounting-cell-text">{getReportCellText(row, column) || '-'}</span>
                      )}
                    </td>
                  ))}
                  {canEditLedgerRows && <td className="accounting-ledger-row-actions"><button type="button" className="accounting-ledger-delete-btn" aria-label="행 삭제" title="행 삭제" disabled={savingLedgerId === String(row.id) || savingLedgerId === 'all'} onClick={() => deleteLedgerRow(row)}>×</button></td>}
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

function statementMoney(value: unknown) {
  const amount = Number(value || 0);
  return amount ? formatMoney(amount) : '-';
}

function editableMoney(value: unknown) {
  const amount = Number(value || 0);
  return amount ? amount.toLocaleString('ko-KR') : '';
}

function cloneProfitLossStatement(statement: any) {
  return JSON.parse(JSON.stringify(statement || {}));
}

function recalcProfitLossStatement(statement: any) {
  const draft = cloneProfitLossStatement(statement);
  const incomeRows = (draft.incomeRows || []).map((row: any) => {
    const count = Number(row.count || 0);
    const corporate = Number(row.corporate || 0);
    const other = Number(row.other || 0);
    const amount = corporate + other;
    return { ...row, count, corporate, other, amount, average: count ? Math.round(amount / count) : 0 };
  });
  const incomeTotal = incomeRows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const expenseSections = (draft.expenseSections || []).map((section: any) => {
    const rows = (section.rows || []).map((row: any) => {
      const count = Number(row.count || 0);
      const corporate = Number(row.corporate || 0);
      const other = Number(row.other || 0);
      const amount = corporate + other;
      return { ...row, count, corporate, other, amount, average: count ? Math.round(amount / count) : 0 };
    });
    const total = rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    return { ...section, rows, total };
  });
  const expenseTotal = expenseSections.reduce((sum: number, section: any) => sum + Number(section.total || 0), 0);
  const laborTotal = Number(expenseSections.find((section: any) => String(section.title || '').startsWith('A.'))?.total || 0);
  const expenseCategorySummary = expenseSections.flatMap((section: any) => (section.rows || [])
    .filter((row: any) => Number(row.amount || 0))
    .map((row: any) => ({ label: row.label, category: section.title, item: row.label, count: Number(row.count || 0), amount: Number(row.amount || 0) })));
  return {
    ...draft,
    incomeRows,
    incomeTotal,
    expenseSections,
    expenseCategorySummary,
    expenseTotal,
    nonLaborExpenseTotal: expenseTotal - laborTotal,
    profit: incomeTotal - expenseTotal,
    finalProfit: incomeTotal - expenseTotal,
  };
}

function ProfitLossStatementView({ statement }: { statement: any }) {
  return <EditableProfitLossStatementView statement={statement} />;
}

function EditableProfitLossStatementView({ statement }: { statement: any }) {
  const [draft, setDraft] = useState<any>(() => recalcProfitLossStatement(statement));
  useEffect(() => {
    setDraft(recalcProfitLossStatement(statement));
  }, [statement]);
  if (!statement) return <div className="empty-state">출력할 손익결산 데이터가 없습니다.</div>;
  const incomeRows = draft.incomeRows || [];
  const expenseSections = draft.expenseSections || [];
  const expenseCategorySummary = draft.expenseCategorySummary || [];
  const branchSummary = draft.branchSummary || [];
  const updateIncomeRow = (index: number, patch: Record<string, unknown>) => {
    setDraft((current: any) => {
      const next = cloneProfitLossStatement(current);
      next.incomeRows[index] = { ...next.incomeRows[index], ...patch };
      return recalcProfitLossStatement(next);
    });
  };
  const updateExpenseRow = (sectionIndex: number, rowIndex: number, patch: Record<string, unknown>) => {
    setDraft((current: any) => {
      const next = cloneProfitLossStatement(current);
      next.expenseSections[sectionIndex].rows[rowIndex] = { ...next.expenseSections[sectionIndex].rows[rowIndex], ...patch };
      return recalcProfitLossStatement(next);
    });
  };
  const addIncomeRow = () => {
    setDraft((current: any) => recalcProfitLossStatement({ ...current, incomeRows: [...(current.incomeRows || []), { label: '추가 수입', count: 1, corporate: 0, other: 0, note: '' }] }));
  };
  const addExpenseRow = (sectionIndex: number) => {
    setDraft((current: any) => {
      const next = cloneProfitLossStatement(current);
      next.expenseSections[sectionIndex].rows.push({ label: '추가 항목', count: 1, corporate: 0, other: 0, note: '' });
      return recalcProfitLossStatement(next);
    });
  };
  const deleteExpenseRow = (sectionIndex: number, rowIndex: number) => {
    setDraft((current: any) => {
      const next = cloneProfitLossStatement(current);
      next.expenseSections[sectionIndex].rows.splice(rowIndex, 1);
      return recalcProfitLossStatement(next);
    });
  };
  return (
    <section className="profit-loss-statement-sheet">
      <div className="profit-loss-statement-title">
        <h3>{draft.title || '손익결산'}</h3>
        <span>(단위 : 원)</span>
      </div>
      <div className="profit-loss-edit-toolbar">
        <button type="button" className="btn btn-sm" onClick={addIncomeRow}>수입 항목 추가</button>
        <button type="button" className="btn btn-sm" onClick={() => setDraft(recalcProfitLossStatement(statement))}>원본으로</button>
      </div>
      {branchSummary.length > 0 && (
        <div className="profit-loss-branch-summary">
          {branchSummary.map((row: any) => (
            <div key={`branch-summary:${row.branch}`} className="profit-loss-branch-row">
              <strong>{row.branch}</strong>
              <span>매출 {statementMoney(row.income)}</span>
              <span>지출 {statementMoney(row.expense)}</span>
              <span className={Number(row.profit || 0) < 0 ? 'negative' : 'positive'}>순이익 {statementMoney(row.profit)}</span>
            </div>
          ))}
        </div>
      )}
      {expenseCategorySummary.length > 0 && (
        <div className="profit-loss-category-summary">
          <div className="profit-loss-category-summary-head">
            <h4>항목별 지출 요약</h4>
            <span>{expenseCategorySummary.length.toLocaleString()}개 항목</span>
          </div>
          <div className="profit-loss-category-grid">
            {expenseCategorySummary.map((row: any) => (
              <div key={`expense-category:${row.category}:${row.label}`} className="profit-loss-category-row" title={`${row.category || ''} ${row.item || row.label}`.trim()}>
                <span className="profit-loss-category-name">{row.label || '기타'}</span>
                <span className="profit-loss-category-count">{Number(row.count || 0).toLocaleString()}건</span>
                <strong>{statementMoney(row.amount)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="table-wrap profit-loss-statement-wrap">
        <table className="profit-loss-statement-table profit-loss-editable-table">
          <colgroup>
            <col className="pl-col-section" />
            <col className="pl-col-label" />
            <col className="pl-col-count" />
            <col className="pl-col-average" />
            <col className="pl-col-money" />
            <col className="pl-col-money" />
            <col className="pl-col-note" />
            <col className="pl-col-action" />
          </colgroup>
          <tbody>
            <tr className="pl-section-head">
              <th>1. 수입</th>
              <th>수입 내역</th>
              <th>건수</th>
              <th>건당평균</th>
              <th>법인(vat포함)</th>
              <th>그외매출</th>
              <th>비고</th>
              <th />
            </tr>
            {incomeRows.map((row: any, index: number) => (
              <tr key={`income-edit:${index}`}>
                <td />
                <td><input className="pl-edit-input" value={row.label || ''} onChange={(event) => updateIncomeRow(index, { label: event.target.value })} /></td>
                <td><input className="pl-edit-input number" type="number" value={Number(row.count || 0)} onChange={(event) => updateIncomeRow(index, { count: event.target.value })} /></td>
                <td className="pl-number">{statementMoney(row.average)}</td>
                <td><input className="pl-edit-input number" inputMode="numeric" value={editableMoney(row.corporate)} onChange={(event) => updateIncomeRow(index, { corporate: toNumber(event.target.value) })} /></td>
                <td><input className="pl-edit-input number" inputMode="numeric" value={editableMoney(row.other)} onChange={(event) => updateIncomeRow(index, { other: toNumber(event.target.value) })} /></td>
                <td><input className="pl-edit-input" value={normalizeText(row.note)} onChange={(event) => updateIncomeRow(index, { note: event.target.value })} /></td>
                <td />
              </tr>
            ))}
            <tr className="pl-total-row">
              <th>a. 총수입합계</th>
              <td />
              <td />
              <td />
              <td className="pl-number">{statementMoney(draft.incomeTotal)}</td>
              <td className="pl-number">-</td>
              <td />
              <td />
            </tr>
            <tr className="pl-spacer"><td colSpan={8} /></tr>
            <tr className="pl-section-head">
              <th>2. 지출</th>
              <th>구분</th>
              <th colSpan={2}>지출 내역</th>
              <th>법인(vat포함)</th>
              <th>그외지출</th>
              <th>비고</th>
              <th />
            </tr>
            {expenseSections.map((section: any, sectionIndex: number) => (
              <Fragment key={`expense-edit:${section.title}`}>
                {(section.rows || []).map((row: any, rowIndex: number) => (
                  <tr key={`${section.title}:${rowIndex}`}>
                    <td>{rowIndex === 0 ? section.title : ''}</td>
                    <td className={rowIndex === 0 ? 'pl-section-total' : ''}>{rowIndex === 0 ? statementMoney(section.total) : ''}</td>
                    <td colSpan={2}><input className="pl-edit-input" value={row.label || ''} onChange={(event) => updateExpenseRow(sectionIndex, rowIndex, { label: event.target.value })} /></td>
                    <td><input className="pl-edit-input number" inputMode="numeric" value={editableMoney(row.corporate)} onChange={(event) => updateExpenseRow(sectionIndex, rowIndex, { corporate: toNumber(event.target.value) })} /></td>
                    <td><input className="pl-edit-input number" inputMode="numeric" value={editableMoney(row.other)} onChange={(event) => updateExpenseRow(sectionIndex, rowIndex, { other: toNumber(event.target.value) })} /></td>
                    <td><input className="pl-edit-input" value={normalizeText(row.note)} onChange={(event) => updateExpenseRow(sectionIndex, rowIndex, { note: event.target.value })} /></td>
                    <td><button type="button" className="accounting-ledger-delete-btn" title="항목 삭제" onClick={() => deleteExpenseRow(sectionIndex, rowIndex)}>×</button></td>
                  </tr>
                ))}
                <tr className="pl-add-row">
                  <td />
                  <td />
                  <td colSpan={6}><button type="button" className="btn btn-sm" onClick={() => addExpenseRow(sectionIndex)}>{section.title} 항목 추가</button></td>
                </tr>
              </Fragment>
            ))}
            <tr className="pl-total-row">
              <th>b. 총지출합계</th>
              <td />
              <td colSpan={2} />
              <td className="pl-number">{statementMoney(draft.expenseTotal)}</td>
              <td className="pl-number">-</td>
              <td>인건비(A) 제외 지출합계 {statementMoney(draft.nonLaborExpenseTotal)}</td>
              <td />
            </tr>
            <tr className="pl-spacer"><td colSpan={8} /></tr>
            <tr className="pl-result-row">
              <th>c. 순이익</th>
              <td colSpan={3}>a - b</td>
              <td className="pl-number">{statementMoney(draft.profit)}</td>
              <td className="pl-number">-</td>
              <td />
              <td />
            </tr>
            <tr className="pl-final-row">
              <th>최종 손익</th>
              <td colSpan={3}>자동 합산</td>
              <td className="pl-number">{statementMoney(draft.finalProfit)}</td>
              <td className="pl-number">-</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProfitLossStatementViewLegacy({ statement }: { statement: any }) {
  if (!statement) return <div className="empty-state">출력할 손익결산 데이터가 없습니다.</div>;
  const incomeRows = statement.incomeRows || [];
  const expenseSections = statement.expenseSections || [];
  const expenseCategorySummary = statement.expenseCategorySummary || [];
  const branchSummary = statement.branchSummary || [];
  return (
    <section className="profit-loss-statement-sheet">
      <div className="profit-loss-statement-title">
        <h3>{statement.title || '손익결산'}</h3>
        <span>(단위 : 원)</span>
      </div>
      {branchSummary.length > 0 && (
        <div className="profit-loss-branch-summary">
          {branchSummary.map((row: any) => (
            <div key={`branch-summary:${row.branch}`} className="profit-loss-branch-row">
              <strong>{row.branch}</strong>
              <span>매출 {statementMoney(row.income)}</span>
              <span>지출 {statementMoney(row.expense)}</span>
              <span className={Number(row.profit || 0) < 0 ? 'negative' : 'positive'}>순이익 {statementMoney(row.profit)}</span>
            </div>
          ))}
        </div>
      )}
      {expenseCategorySummary.length > 0 && (
        <div className="profit-loss-category-summary">
          <div className="profit-loss-category-summary-head">
            <h4>항목별 지출 요약</h4>
            <span>{expenseCategorySummary.length.toLocaleString()}개 항목</span>
          </div>
          <div className="profit-loss-category-grid">
            {expenseCategorySummary.map((row: any) => (
              <div key={`expense-category:${row.label}`} className="profit-loss-category-row" title={`${row.category || ''} ${row.item || row.label}`.trim()}>
                <span className="profit-loss-category-name">{row.label || '기타'}</span>
                <span className="profit-loss-category-count">{Number(row.count || 0).toLocaleString()}건</span>
                <strong>{statementMoney(row.amount)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="table-wrap profit-loss-statement-wrap">
        <table className="profit-loss-statement-table">
          <colgroup>
            <col className="pl-col-section" />
            <col className="pl-col-label" />
            <col className="pl-col-count" />
            <col className="pl-col-average" />
            <col className="pl-col-money" />
            <col className="pl-col-money" />
            <col className="pl-col-note" />
          </colgroup>
          <tbody>
            <tr className="pl-section-head">
              <th>1. 수입</th>
              <th>수입 내역</th>
              <th>건수</th>
              <th>건당평균</th>
              <th>법인(vat포함)</th>
              <th>그외매출</th>
              <th>비고</th>
            </tr>
            {incomeRows.map((row: any) => (
              <tr key={`income:${row.label}`}>
                <td />
                <td>{row.label}</td>
                <td className="pl-number">{Number(row.count || 0) || '-'}</td>
                <td className="pl-number">{statementMoney(row.average)}</td>
                <td className="pl-number">{statementMoney(row.corporate)}</td>
                <td className="pl-number">{statementMoney(row.other)}</td>
                <td title={normalizeText(row.note)}>{normalizeText(row.note)}</td>
              </tr>
            ))}
            <tr className="pl-total-row">
              <th>a. 총수입합계</th>
              <td />
              <td />
              <td />
              <td className="pl-number">{statementMoney(statement.incomeTotal)}</td>
              <td className="pl-number">-</td>
              <td />
            </tr>
            <tr className="pl-spacer"><td colSpan={7} /></tr>
            <tr className="pl-section-head">
              <th>2. 지출</th>
              <th>구분</th>
              <th colSpan={2}>지출 내역</th>
              <th>법인(vat포함)</th>
              <th>그외지출</th>
              <th>비고</th>
            </tr>
            {expenseSections.map((section: any) => (
              <Fragment key={section.title}>
                {(section.rows || []).map((row: any, index: number) => (
                  <tr key={`${section.title}:${row.label}`}>
                    <td>{index === 0 ? section.title : ''}</td>
                    <td className={index === 0 ? 'pl-section-total' : ''}>{index === 0 ? statementMoney(section.total) : ''}</td>
                    <td colSpan={2}>{row.label}</td>
                    <td className="pl-number">{statementMoney(row.corporate)}</td>
                    <td className="pl-number">{statementMoney(row.other)}</td>
                    <td title={normalizeText(row.note)}>{normalizeText(row.note)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="pl-total-row">
              <th>b. 총지출합계</th>
              <td />
              <td colSpan={2} />
              <td className="pl-number">{statementMoney(statement.expenseTotal)}</td>
              <td className="pl-number">-</td>
              <td>인건비(A) 제외 지출합계 {statementMoney(statement.nonLaborExpenseTotal)}</td>
            </tr>
            <tr className="pl-spacer"><td colSpan={7} /></tr>
            <tr className="pl-result-row">
              <th>3. 손익 합계</th>
              <td colSpan={3}>( a - b )</td>
              <td className="pl-number">{statementMoney(statement.profit)}</td>
              <td className="pl-number">-</td>
              <td />
            </tr>
            <tr className="pl-final-row">
              <th>4. 최종 손익</th>
              <td colSpan={3}>(손익 합계 - 이익금의 15%)</td>
              <td className="pl-number">{statementMoney(statement.finalProfit)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

void ProfitLossStatementViewLegacy;

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
  const branchOrder: string[] = [...CANONICAL_BRANCHES];
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
        branch: normalizeReportBranch(branchKey) || branchKey,
        teams,
        total: teams.reduce((sum, team) => sum + team.total, 0),
        staffCount: teams.reduce((sum, team) => sum + team.staffCount, 0),
      };
    });
}

function formatShortReportDate(value: unknown) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return text;
  return `${Number(match[2])}월${Number(match[3])}일`;
}

function formatReportSource(row: any) {
  const policy = normalizeText(row.ledger_policy);
  if (policy) return policy;
  const source = normalizeText(row.source_type);
  if (source === 'checkCard') return '체크';
  if (source === 'bank') return '계좌이체';
  if (source === 'creditCard') return '신용카드';
  return source;
}

function formatCardLast4(value: unknown) {
  const text = normalizeCardLast4(value);
  if (!text) return '';
  return text;
}

function isBlankReportValue(value: unknown) {
  const text = normalizeText(value);
  return !text || text === '-' || text === '—';
}

function isRequiredExpenseLedgerCellEmpty(row: any, column: { key: string; numeric?: boolean }) {
  if (column.numeric || column.key === 'card_last4') return false;
  if (column.key === 'entry_date') return isBlankReportValue(row.entry_date || row.date);
  if (column.key === 'ledger_policy') return isBlankReportValue(formatReportSource(row));
  return isBlankReportValue(row[column.key]);
}

function getReportCellText(row: any, column: { key: string }) {
  if (column.key === 'entry_date') return formatShortReportDate(row.entry_date || row.date);
  if (column.key === 'ledger_policy') return formatReportSource(row);
  if (column.key === 'card_last4') return formatCardLast4(row.card_last4);
  return normalizeText(row[column.key]);
}

function getReportCellTitle(row: any, column: { key: string }) {
  if (column.key === 'entry_date') return normalizeText(row.entry_date || row.date);
  if (column.key === 'ledger_policy') return formatReportSource(row);
  if (column.key === 'card_last4') return normalizeText(row.card_last4);
  return normalizeText(row[column.key]);
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
      { key: 'review_reason', label: '검토사유' },
      { key: 'entry_date', label: '일자' },
      { key: 'source_type', label: '자료출처' },
      { key: 'branch', label: '지사' },
      { key: 'category', label: '분류' },
      { key: 'item', label: '항목' },
      { key: 'amount', label: '금액', numeric: true },
      { key: 'duplicate_match', label: '중복상대' },
      { key: 'status', label: '검토상태' },
      { key: 'duplicate_status', label: '중복상태' },
      { key: 'memo', label: '검토메모/증빙' },
    ];
  }
  return [
    { key: 'entry_date', label: '일자' },
    { key: 'branch', label: '지사' },
    { key: 'owner_name', label: '담당자' },
    { key: 'category', label: '분류' },
    { key: 'item', label: '항목' },
    { key: 'description', label: '내용' },
    { key: 'amount', label: '금액', numeric: true },
    { key: 'ledger_policy', label: '원천' },
    { key: 'card_last4', label: '카드번호' },
    { key: 'memo', label: '증빙' },
  ];
}
