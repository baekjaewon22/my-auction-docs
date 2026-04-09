import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User, UserAccounting, SalesEvaluation, SalesRecord } from '../types';
import { ROLE_LABELS, BRANCHES } from '../types';
import type { Role } from '../types';
import Select from '../components/Select';
import {
  BookOpenCheck, ChevronLeft, TrendingDown, TrendingUp, AlertTriangle,
  ArrowDownCircle, Plus, X, Pencil, RotateCcw, Users as UsersIcon
} from 'lucide-react';

const GRADE_OPTIONS = ['M1', 'M2', 'M3', 'M4'] as const;
const GRADE_COLORS: Record<string, string> = { M1: '#188038', M2: '#1a73e8', M3: '#e65100', M4: '#d93025' };

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '입금대기', color: '#e65100', bg: '#fff3e0' },
  confirmed: { label: '확정매출', color: '#188038', bg: '#e8f5e9' },
  refund_requested: { label: '환불신청', color: '#d93025', bg: '#fce4ec' },
  refunded: { label: '환불완료', color: '#9aa0a6', bg: '#f5f5f5' },
};

function formatCurrency(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}
function toMoneyDisplay(val: string): string {
  const num = val.replace(/[^0-9]/g, '');
  return num ? Number(num).toLocaleString('ko-KR') : '';
}
function fromMoneyDisplay(val: string): string {
  return val.replace(/[^0-9]/g, '');
}

function getEvaluationPeriods(count: number = 3) {
  const periods: { start: string; end: string; label: string }[] = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startMonth = month % 2 === 0 ? month - 1 : month;
  for (let i = 0; i < count; i++) {
    let m = startMonth - i * 2;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    const endMonth = m + 1 > 12 ? 1 : m + 1;
    const endYear = m + 1 > 12 ? y + 1 : y;
    const lastDay = new Date(endYear, endMonth, 0).getDate();
    periods.push({
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${endYear}-${String(endMonth).padStart(2, '0')}-${lastDay}`,
      label: `${y}년 ${m}~${endMonth}월`,
    });
  }
  return periods;
}

export default function Accounting() {
  const { user: currentUser } = useAuthStore();
  const [mainTab, setMainTab] = useState<'sales' | 'staff' | 'card'>('sales');

  // ━━ 공통 ━━
  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<UserAccounting[]>([]);
  const [loading, setLoading] = useState(true);
  // canModify: 수정 가능 (총무담당 + 총무보조 둘 다)
  // canApprove: 최종승인만 (총무담당만, 보조 불가)
  const canModify = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');
  const canApprove = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(currentUser?.role || '');
  const canEdit = canModify; // 하위 호환

  // ━━ 매출 전체 탭 ━━
  const [allSales, setAllSales] = useState<SalesRecord[]>([]);
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filterBranch, setFilterBranch] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [memoText, setMemoText] = useState('');
  const [confirmingId] = useState<string | null>(null);
  const [filterDirection, setFilterDirection] = useState<'' | 'income' | 'expense'>('');
  // 매출내역 추가 폼
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryAmount, setEntryAmount] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryAssignee, setEntryAssignee] = useState('');
  const [entryDirection, setEntryDirection] = useState<'income' | 'expense'>('income');

  // ━━ 카드사용내역 탭 ━━
  const [cardTxns, setCardTxns] = useState<any[]>([]);
  const [cardSummary, setCardSummary] = useState<{ by_branch: any[]; by_user: any[] }>({ by_branch: [], by_user: [] });
  const [cardMonth, setCardMonth] = useState('');
  const [cardFilterBranch, setCardFilterBranch] = useState('');
  const [cardFilterUser, setCardFilterUser] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);

  // ━━ 직원 관리 탭 ━━
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [, setSelectedAccount] = useState<UserAccounting | null>(null);
  const [evaluations, setEvaluations] = useState<SalesEvaluation[]>([]);
  const [userSalesRecords, setUserSalesRecords] = useState<SalesRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [salaryInput, setSalaryInput] = useState('');
  const [gradeInput, setGradeInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, accountsRes] = await Promise.all([
        api.users.list(),
        api.accounting.list(),
      ]);
      setUsers(usersRes.users);
      setAccounts(accountsRes.accounts);
    } catch (err: any) { console.error(err); }
    finally { setLoading(false); }
  };

  const loadSales = async () => {
    try {
      const res = await api.sales.list({ month: filterMonth, user_id: filterUser || undefined });
      // 회계장부는 입금확인된 건만 (confirmed + refunded + refund_requested)
      // pending은 매출확인에서 처리
      setAllSales((res.records || []).filter((r: SalesRecord) => r.status !== 'pending'));
    } catch { setAllSales([]); }
  };

  const loadCard = async () => {
    try {
      const [txRes, sumRes] = await Promise.all([
        api.card.transactions({ month: cardMonth, branch: cardFilterBranch || undefined, user_id: cardFilterUser || undefined }),
        api.card.summary(cardMonth),
      ]);
      setCardTxns(txRes.transactions || []);
      setCardSummary(sumRes);
    } catch { setCardTxns([]); }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      if (json.length === 0) { alert('데이터가 없습니다.'); return; }

      const cols = Object.keys(json[0]);
      setExcelColumns(cols);
      console.log('엑셀 컬럼:', cols);
      console.log('첫 행:', json[0]);

      // 각 컬럼 역할 자동 추정 (키워드 매칭)
      const guess = (candidates: string[]) => cols.find(c => candidates.some(s => c.includes(s))) || '';
      const colCard = guess(['카드번호', '카드', 'card']);
      const colDate = guess(['이용일', '거래일', '일자', '날짜', '승인일', '이용일자', '거래일시']);
      const colMerchant = guess(['가맹점', '이용처', '상호', '가맹점명', '매출처', '적요', '내용', '거래내용', '취급점']);
      const colAmount = guess(['이용금액', '금액', '결제금액', '매출금액', '승인금액', '이용원금', '국내이용금액', '거래금액', '출금', '지급']);
      const colDesc = guess(['비고', '적요', '내용', '메모', '거래내용']);

      console.log('매칭된 컬럼:', { colCard, colDate, colMerchant, colAmount, colDesc });

      const rows = json.map((row: any) => {
        const allVals = cols.map(c => ({ key: c, val: String(row[c] ?? '') }));

        // 카드번호: 키 매칭 → 패턴 탐색 (****-****-****-**** 또는 숫자 4자리~16자리)
        let cardNum = '';
        if (colCard) {
          cardNum = String(row[colCard] || '').trim();
        }
        if (!cardNum) {
          // 모든 셀에서 카드번호 패턴 찾기
          for (const { val } of allVals) {
            if (/\d{4}[- *]+\d{2,4}[* ]*[- *]+[* ]*\d{0,4}[- *]+\d{4}/.test(val) || /^\d{4}-\d{2}\*{2}-\*{4}-\d{4}$/.test(val)) {
              cardNum = val.trim(); break;
            }
          }
        }

        // 날짜: 키 매칭 → 패턴 탐색
        let dateRaw = colDate ? String(row[colDate] || '') : '';
        if (!dateRaw) {
          for (const { val } of allVals) {
            if (/20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(val)) { dateRaw = val; break; }
          }
        }
        const dm = dateRaw.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
        const normalizedDate = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : dateRaw.slice(0, 10);

        // 가맹점
        const merchant = colMerchant ? String(row[colMerchant] || '') : '';

        // 금액: 키 매칭 → 없으면 숫자 큰 값
        let amountRaw = colAmount ? row[colAmount] : null;
        if (amountRaw === null || amountRaw === undefined || amountRaw === '') {
          for (const { key, val } of allVals) {
            const n = Number(val.replace(/[^0-9.-]/g, ''));
            if (n >= 100 && !key.includes('번호') && !key.includes('잔액')) { amountRaw = val; break; }
          }
        }
        const amount = Math.abs(Number(String(amountRaw || '0').replace(/[^0-9.-]/g, '')) || 0);

        // 비고
        const desc = colDesc && colDesc !== colMerchant ? String(row[colDesc] || '') : '';

        return { card_number: cardNum, transaction_date: normalizedDate, merchant_name: merchant, amount, description: desc };
      }).filter((r: any) => r.amount > 0);

      if (rows.length === 0) { alert('유효한 금액 데이터가 없습니다.\n감지된 컬럼: ' + cols.join(', ')); return; }

      // 미리보기 표시
      setPreviewRows(rows);
    } catch (err: any) {
      alert('엑셀 파싱 실패: ' + (err.message || ''));
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmUpload = async () => {
    if (!previewRows) return;
    setUploading(true);
    try {
      const result = await api.card.upload(previewRows);
      alert(`${result.inserted}건 저장 완료`);
      setPreviewRows(null);
      loadCard();
    } catch (err: any) { alert(err.message); }
    finally { setUploading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (mainTab === 'sales') loadSales(); }, [mainTab, filterMonth, filterUser]);
  useEffect(() => { if (mainTab === 'card') loadCard(); }, [mainTab, cardMonth, cardFilterBranch, cardFilterUser]);

  // ━━ 매출 전체 탭 핸들러 ━━
  const handleRefundApprove = async (id: string) => {
    if (!confirm('환불을 승인하시겠습니까?')) return;
    try { await api.sales.refundApprove(id); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handleMemoSave = async (id: string) => {
    try { await api.sales.updateMemo(id, memoText); setEditingMemo(null); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 매출 내역을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.')) return;
    try { await api.sales.delete(id); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handlePaymentMethod = async (id: string, method: string) => {
    try { await api.sales.updatePaymentMethod(id, method); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handleAddEntry = async () => {
    if (!entryAmount || !entryAssignee) { alert('금액과 담당자를 입력하세요.'); return; }
    try {
      await api.sales.createAccountingEntry({
        amount: Number(entryAmount), content: entryContent, date: entryDate, assignee_id: entryAssignee, direction: entryDirection,
      });
      setShowEntryForm(false); setEntryAmount(''); setEntryContent(''); setEntryAssignee(''); setEntryDirection('income');
      loadSales();
    } catch (err: any) { alert(err.message); }
  };

  // ━━ 직원 관리 탭 핸들러 ━━
  const handleSelectUser = async (u: User) => {
    setSelectedUser(u);
    try {
      const [accRes, evalRes, salesRes] = await Promise.all([
        api.accounting.get(u.id),
        api.accounting.evaluations(u.id),
        api.sales.list({ user_id: u.id }),
      ]);
      setUserSalesRecords(salesRes.records || []);
      const acc = accRes.account;
      setSelectedAccount(acc);
      setSalaryInput(acc?.salary?.toString() || '');
      setGradeInput(acc?.grade || '');
      setEvaluations(evalRes.evaluations);
    } catch {
      setSelectedAccount(null); setEvaluations([]); setUserSalesRecords([]);
    }
  };

  const handleSave = async () => {
    if (!selectedUser || !canEdit) return;
    setSaving(true);
    try {
      await api.accounting.update(selectedUser.id, { salary: Number(salaryInput) || 0, grade: gradeInput });
      load();
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleGradeDemotion = async (userId: string, newGrade: string) => {
    if (!confirm(`직급을 ${newGrade}로 변경하시겠습니까?`)) return;
    try {
      await api.accounting.updateGrade(userId, newGrade);
      if (selectedUser) handleSelectUser(selectedUser);
      load();
    } catch (err: any) { alert(err.message); }
  };

  const handleEvaluate = async (periodStart: string, periodEnd: string) => {
    if (!confirm(`${periodStart} ~ ${periodEnd} 매출 평가를 실행하시겠습니까?`)) return;
    try {
      await api.accounting.evaluate(periodStart, periodEnd);
      alert('평가 완료');
      if (selectedUser) handleSelectUser(selectedUser);
    } catch (err: any) { alert(err.message); }
  };

  const calculatedStandardSales = Math.round((Number(salaryInput) || 0) * 1.3 * 4);

  // 필터
  const filteredMembers = filterBranch ? users.filter(u => u.branch === filterBranch) : users;
  const memberOpts = filteredMembers.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` }));
  const branchOpts = BRANCHES.map(b => ({ value: b, label: b }));
  const filteredStaffUsers = users.filter(u =>
    u.name.includes(searchTerm) || u.department?.includes(searchTerm) || u.branch?.includes(searchTerm)
  );
  const getAccountForUser = (userId: string) => accounts.find(a => a.user_id === userId);

  // 매출 통계 + 수입/지출 필터
  const displaySales = filterDirection ? allSales.filter(r => r.direction === filterDirection) : allSales;
  const contractCount = displaySales.filter(r => r.type === '계약' && r.status !== 'refunded').length;
  const pendingTotal = displaySales.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
  const incomeTotal = allSales.filter(r => r.direction !== 'expense' && r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);
  const expenseTotal = allSales.filter(r => r.direction === 'expense' && r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);

  if (loading) return <div className="page-loading">로딩중...</div>;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 직원 상세 (직원 관리 탭에서 클릭)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (selectedUser) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setSelectedUser(null)}><ChevronLeft size={16} /> 목록</button>
            <BookOpenCheck size={24} /> {selectedUser.name} — 회계 정보
          </h2>
        </div>

        {/* 기본 정보 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem' }}>직원 정보</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>이름</span><div style={{ fontWeight: 600 }}>{selectedUser.name}</div></div>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>역할</span><div>{ROLE_LABELS[selectedUser.role as Role]}</div></div>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>지사</span><div>{selectedUser.branch || '-'}</div></div>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>부서</span><div>{selectedUser.department || '-'}</div></div>
          </div>
        </div>

        {/* 급여 & 직급 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem' }}>급여 및 직급 설정</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            <div>
              <label className="form-label">급여 (월급)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="form-input" value={toMoneyDisplay(salaryInput)} onChange={(e) => setSalaryInput(fromMoneyDisplay(e.target.value))} disabled={!canEdit} style={{ flex: 1 }} />
                <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
              </div>
            </div>
            <div>
              <label className="form-label">기준매출 (급여 x 1.3 x 4)</label>
              <div style={{ padding: '10px 14px', background: calculatedStandardSales > 0 ? '#e8f5e9' : '#f5f5f5', borderRadius: 8, fontSize: '1.1rem', fontWeight: 700, color: calculatedStandardSales > 0 ? '#188038' : '#9aa0a6' }}>
                {calculatedStandardSales > 0 ? formatCurrency(calculatedStandardSales) : '-'}
              </div>
            </div>
            <div>
              <label className="form-label">직급단계</label>
              <select className="form-input" value={gradeInput} onChange={(e) => setGradeInput(e.target.value)} disabled={!canEdit} style={{ width: '100%' }}>
                <option value="">미지정</option>
                {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          {canEdit && <div style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '저장중...' : '저장'}</button></div>}
        </div>

        {/* 매출 평가 이력 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>매출 평가 이력</h3>
            {canEdit && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {getEvaluationPeriods(3).map(p => <button key={p.start} className="btn btn-sm" onClick={() => handleEvaluate(p.start, p.end)}>{p.label} 평가</button>)}
            </div>}
          </div>
          {evaluations.length === 0 ? <div className="empty-state">매출 평가 기록이 없습니다.</div> : (
            <div className="table-wrapper"><table className="data-table"><thead><tr><th>기간</th><th>기준매출</th><th>실제매출</th><th>달성률</th><th>결과</th><th>연속미달</th></tr></thead><tbody>
              {evaluations.map(ev => {
                const rate = ev.standard_sales > 0 ? (ev.total_sales / ev.standard_sales * 100) : 0;
                return (<tr key={ev.id} style={{ background: ev.consecutive_misses >= 3 ? '#fce4ec' : ev.met_target ? '#e8f5e9' : '#fff3e0' }}>
                  <td style={{ fontSize: '0.82rem' }}>{ev.period_start} ~ {ev.period_end}</td>
                  <td>{formatCurrency(ev.standard_sales)}</td>
                  <td style={{ fontWeight: 700 }}>{formatCurrency(ev.total_sales)}</td>
                  <td><span style={{ color: rate >= 100 ? '#188038' : rate >= 70 ? '#e65100' : '#d93025', fontWeight: 700 }}>{rate.toFixed(1)}%</span></td>
                  <td>{ev.met_target ? <span style={{ color: '#188038' }}><TrendingUp size={14} /> 달성</span> : <span style={{ color: '#d93025' }}><TrendingDown size={14} /> 미달</span>}</td>
                  <td>{ev.consecutive_misses >= 3 ? <span style={{ color: '#d93025', fontWeight: 700 }}><AlertTriangle size={14} /> {ev.consecutive_misses}회</span> : ev.consecutive_misses > 0 ? <span style={{ color: '#e65100' }}>{ev.consecutive_misses}회</span> : '-'}</td>
                </tr>);
              })}
            </tbody></table></div>
          )}
        </div>

        {/* 강등 대상 */}
        {evaluations.some(ev => ev.consecutive_misses >= 3) && canEdit && (
          <div className="card" style={{ marginBottom: 20, padding: 20, border: '2px solid #d93025', background: '#fce4ec' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#d93025', display: 'flex', alignItems: 'center', gap: 8 }}><ArrowDownCircle size={20} /> 강등 대상</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {GRADE_OPTIONS.filter(g => g !== gradeInput).map(g => <button key={g} className="btn btn-sm btn-danger" onClick={() => handleGradeDemotion(selectedUser.id, g)}>{g}로 변경</button>)}
            </div>
          </div>
        )}

        {/* 매출 내역 */}
        {userSalesRecords.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>매출 내역</h3>
            <div className="table-wrapper"><table className="data-table"><thead><tr><th>일자</th><th>유형</th><th>회원명</th><th>금액</th><th>입금일</th><th>상태</th><th>메모</th></tr></thead><tbody>
              {userSalesRecords.map(r => {
                const isRefunded = r.status === 'refunded';
                const st = STATUS_LABELS[r.status];
                return (<tr key={r.id} style={isRefunded ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  <td style={{ fontSize: '0.8rem' }}>{r.contract_date}</td><td>{r.type}</td><td>{r.client_name}</td>
                  <td style={{ fontWeight: 600 }}>{formatCurrency(r.amount)}</td>
                  <td style={{ fontSize: '0.78rem', color: r.deposit_date ? '#188038' : '#9aa0a6' }}>{r.deposit_date || '-'}</td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span></td>
                  <td style={{ fontSize: '0.72rem', color: '#7b1fa2' }}>{r.memo || '-'}</td>
                </tr>);
              })}
            </tbody></table></div>
          </div>
        )}
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 메인 (탭 구조)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="page">
      <div className="page-header">
        <h2><BookOpenCheck size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 회계장부</h2>
        {mainTab === 'sales' && canEdit && (
          <button className="btn btn-primary" onClick={() => setShowEntryForm(true)}>
            <Plus size={14} /> 매출내역 추가
          </button>
        )}
      </div>

      {/* 탭 */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <button className={`filter-btn ${mainTab === 'sales' ? 'active' : ''}`} onClick={() => setMainTab('sales')}>
          매출 전체
        </button>
        <button className={`filter-btn ${mainTab === 'staff' ? 'active' : ''}`} onClick={() => setMainTab('staff')}>
          <UsersIcon size={14} style={{ marginRight: 4 }} /> 직원 관리
        </button>
        <button className={`filter-btn ${mainTab === 'card' ? 'active' : ''}`} onClick={() => setMainTab('card')}>
          카드사용내역
        </button>
      </div>

      {/* ━━ 매출 전체 탭 ━━ */}
      {mainTab === 'sales' && (
        <>
          {/* 매출내역 추가 폼 */}
          {showEntryForm && canEdit && (
            <div className="card" style={{ marginBottom: 20, padding: 20, border: '2px solid #1a73e8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>매출내역 추가</h3>
                <button className="btn-icon" onClick={() => setShowEntryForm(false)}><X size={16} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label className="form-label">구분</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => setEntryDirection('income')}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '2px solid', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                        background: entryDirection === 'income' ? '#188038' : '#fff', color: entryDirection === 'income' ? '#fff' : '#188038',
                        borderColor: '#188038' }}>+수입</button>
                    <button type="button" onClick={() => setEntryDirection('expense')}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '2px solid', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                        background: entryDirection === 'expense' ? '#d93025' : '#fff', color: entryDirection === 'expense' ? '#fff' : '#d93025',
                        borderColor: '#d93025' }}>-지출</button>
                  </div>
                </div>
                <div><label className="form-label">금액 (부가세 포함)</label><input className="form-input" value={toMoneyDisplay(entryAmount)} onChange={(e) => setEntryAmount(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} /></div>
                <div><label className="form-label">내용</label><input className="form-input" value={entryContent} onChange={(e) => setEntryContent(e.target.value)} style={{ width: '100%' }} placeholder="내용" /></div>
                <div><label className="form-label">일시</label><input className="form-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={{ width: '100%' }} /></div>
                <div><label className="form-label">담당자</label>
                  <Select size="sm" options={[{ value: '__all__', label: '전체 (미지정)' }, ...users.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` }))]}
                    value={entryAssignee === '__all__' ? { value: '__all__', label: '전체 (미지정)' } : users.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` })).find(o => o.value === entryAssignee) || null}
                    onChange={(o: any) => setEntryAssignee(o?.value || '')} placeholder="담당자 선택" isSearchable /></div>
              </div>
              <div style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={handleAddEntry}>등록</button></div>
            </div>
          )}

          {/* 필터 */}
          <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="month" className="form-input" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ width: 160 }} />
            <div style={{ minWidth: 120 }}>
              <Select size="sm" options={[{ value: '', label: '전체 지사' }, ...branchOpts]}
                value={branchOpts.find(o => o.value === filterBranch) || { value: '', label: '전체 지사' }}
                onChange={(o: any) => { setFilterBranch(o?.value || ''); setFilterUser(''); }} placeholder="지사" isClearable />
            </div>
            <div style={{ minWidth: 200 }}>
              <Select size="sm" options={[{ value: '', label: '전체 담당자' }, ...memberOpts]}
                value={memberOpts.find(o => o.value === filterUser) || { value: '', label: '전체 담당자' }}
                onChange={(o: any) => setFilterUser(o?.value || '')} placeholder="담당자" isClearable />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button className={`filter-btn ${filterDirection === '' ? 'active' : ''}`} onClick={() => setFilterDirection('')} style={{ padding: '3px 10px', fontSize: '0.75rem' }}>전체</button>
              <button className={`filter-btn ${filterDirection === 'income' ? 'active' : ''}`} onClick={() => setFilterDirection('income')} style={{ padding: '3px 10px', fontSize: '0.75rem', color: filterDirection === 'income' ? '#fff' : '#188038' }}>+수입</button>
              <button className={`filter-btn ${filterDirection === 'expense' ? 'active' : ''}`} onClick={() => setFilterDirection('expense')} style={{ padding: '3px 10px', fontSize: '0.75rem', color: filterDirection === 'expense' ? '#fff' : '#d93025' }}>-지출</button>
            </div>
            <div style={{ display: 'flex', gap: 14, marginLeft: 'auto', fontSize: '0.82rem', flexWrap: 'wrap' }}>
              <span>+수입 <strong style={{ color: '#188038' }}>{formatCurrency(incomeTotal)}</strong></span>
              <span>-지출 <strong style={{ color: '#d93025' }}>{formatCurrency(expenseTotal)}</strong></span>
              <span>잔액 <strong style={{ color: incomeTotal - expenseTotal >= 0 ? '#1a73e8' : '#d93025' }}>{formatCurrency(incomeTotal - expenseTotal)}</strong></span>
              <span>계약 <strong>{contractCount}</strong>건</span>
              <span>대기 <strong style={{ color: '#e65100' }}>{formatCurrency(pendingTotal)}</strong></span>
            </div>
          </div>

          {/* 매출 목록 */}
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th></th><th>일자</th><th>담당자</th><th>유형</th><th>회원명</th><th>금액</th><th>입금일</th><th>상태</th><th>액션</th></tr></thead>
              <tbody>
                {displaySales.map(r => {
                  const st = STATUS_LABELS[r.status];
                  const isRefunded = r.status === 'refunded';
                  const isConfirming = confirmingId === r.id;
                  return (
                    <tr key={r.id} style={isRefunded ? { opacity: 0.5, textDecoration: 'line-through', background: '#fafafa' } : undefined}>
                      <td style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', color: r.direction === 'expense' ? '#d93025' : '#188038' }}>
                        {r.direction === 'expense' ? '-' : '+'}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>{r.contract_date}</td>
                      <td>{r.user_name}</td>
                      <td><span style={{ fontSize: '0.8rem' }}>{r.type}</span>{r.type === '기타' && r.type_detail && <span style={{ color: '#9aa0a6', fontSize: '0.72rem' }}> ({r.type_detail})</span>}</td>
                      <td>
                        {r.client_name}
                        {r.depositor_different === 1 && r.depositor_name && <div style={{ fontSize: '0.7rem', color: '#e65100' }}>입금자: {r.depositor_name}</div>}
                      </td>
                      <td style={{ fontWeight: 600, color: r.direction === 'expense' ? '#d93025' : '#188038' }}>
                        {r.direction === 'expense' ? '-' : '+'}{formatCurrency(r.amount)}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: r.deposit_date ? '#188038' : '#9aa0a6' }}>{r.deposit_date || '-'}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                        {/* 카드/이체 표시 */}
                        {canEdit && (
                          <div style={{ display: 'inline-flex', gap: 2, marginLeft: 4, verticalAlign: 'middle' }}>
                            <button onClick={() => handlePaymentMethod(r.id, r.payment_method === '카드' ? '' : '카드')}
                              style={{ padding: '1px 5px', fontSize: '0.6rem', borderRadius: 4, border: '1px solid', cursor: 'pointer',
                                background: r.payment_method === '카드' ? '#1a73e8' : '#fff', color: r.payment_method === '카드' ? '#fff' : '#9aa0a6',
                                borderColor: r.payment_method === '카드' ? '#1a73e8' : '#dadce0' }}>카드</button>
                            <button onClick={() => handlePaymentMethod(r.id, r.payment_method === '이체' ? '' : '이체')}
                              style={{ padding: '1px 5px', fontSize: '0.6rem', borderRadius: 4, border: '1px solid', cursor: 'pointer',
                                background: r.payment_method === '이체' ? '#188038' : '#fff', color: r.payment_method === '이체' ? '#fff' : '#9aa0a6',
                                borderColor: r.payment_method === '이체' ? '#188038' : '#dadce0' }}>이체</button>
                          </div>
                        )}
                        {!canEdit && r.payment_method && (
                          <span style={{ marginLeft: 4, fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4,
                            background: r.payment_method === '카드' ? '#e8f0fe' : '#e8f5e9',
                            color: r.payment_method === '카드' ? '#1a73e8' : '#188038' }}>{r.payment_method}</span>
                        )}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.status === 'refund_requested' && canApprove && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleRefundApprove(r.id)}><RotateCcw size={13} /> 환불승인</button>
                          )}
                          {canEdit && !isConfirming && (
                            <button className="btn btn-sm" onClick={() => { setEditingMemo(r.id); setMemoText(r.memo); }}><Pencil size={12} /></button>
                          )}
                          {canEdit && !isConfirming && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)} title="삭제" style={{ padding: '2px 6px' }}><X size={12} /></button>
                          )}
                        </div>
                        {editingMemo === r.id && (
                          <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                            <input className="form-input" value={memoText} onChange={(e) => setMemoText(e.target.value)} placeholder="회계 메모" style={{ flex: 1, fontSize: '0.8rem' }} />
                            <button className="btn btn-sm btn-primary" onClick={() => handleMemoSave(r.id)}>저장</button>
                            <button className="btn btn-sm" onClick={() => setEditingMemo(null)}>취소</button>
                          </div>
                        )}
                        {r.memo && editingMemo !== r.id && <div style={{ fontSize: '0.7rem', color: '#7b1fa2', marginTop: 4 }}>메모: {r.memo}</div>}
                      </td>
                    </tr>
                  );
                })}
                {displaySales.length === 0 && <tr><td colSpan={9} className="empty-state">내역이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ━━ 직원 관리 탭 ━━ */}
      {mainTab === 'staff' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <input type="text" className="form-input" placeholder="이름, 지사, 부서로 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ maxWidth: 320 }} />
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>이름</th><th>역할</th><th>지사</th><th>부서</th><th>급여</th><th>기준매출</th><th>직급</th></tr></thead>
              <tbody>
                {filteredStaffUsers.map(u => {
                  const acc = getAccountForUser(u.id);
                  return (
                    <tr key={u.id} onClick={() => handleSelectUser(u)} className="clickable-row" style={{ cursor: 'pointer' }}>
                      <td><strong>{u.name}</strong></td>
                      <td><span className={`role-badge role-${u.role}`}>{ROLE_LABELS[u.role as Role]}</span></td>
                      <td>{u.branch || '-'}</td>
                      <td>{u.department || '-'}</td>
                      <td>{acc?.salary ? formatCurrency(acc.salary) : <span style={{ color: '#9aa0a6' }}>미설정</span>}</td>
                      <td>{acc?.standard_sales ? formatCurrency(acc.standard_sales) : <span style={{ color: '#9aa0a6' }}>-</span>}</td>
                      <td>{acc?.grade ? <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 700, background: GRADE_COLORS[acc.grade] + '18', color: GRADE_COLORS[acc.grade] }}>{acc.grade}</span> : <span style={{ color: '#9aa0a6' }}>-</span>}</td>
                    </tr>
                  );
                })}
                {filteredStaffUsers.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#9aa0a6', padding: 32 }}>검색 결과가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ━━ 카드사용내역 탭 ━━ */}
      {mainTab === 'card' && (
        <>
          {/* 상단 액션바 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: '0.85rem', color: '#5f6368' }}>
              {cardTxns.length > 0 && <span>총 <strong>{cardTxns.length}</strong>건</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {canModify && cardTxns.length > 0 && (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.75rem' }} onClick={async () => {
                  const scope = cardMonth ? `${cardMonth} 월` : '전체';
                  if (!confirm(`${scope} 카드내역 ${cardTxns.length}건을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
                  try {
                    for (const t of cardTxns) await api.card.deleteTransaction(t.id);
                    loadCard();
                  } catch (err: any) { alert(err.message); }
                }}>전체 삭제 ({cardTxns.length}건)</button>
              )}
              {canModify && (
                <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={13} /> {uploading ? '업로드 중...' : '엑셀 업로드'}
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} style={{ display: 'none' }} disabled={uploading} />
                </label>
              )}
            </div>
          </div>

          {/* 필터 */}
          <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="month" className="form-input" value={cardMonth} onChange={(e) => setCardMonth(e.target.value)}
              style={{ width: 150, fontSize: '0.82rem' }} />
            <div style={{ minWidth: 110 }}>
              <Select size="sm" options={[{ value: '', label: '전체 지사' }, { value: '의정부', label: '의정부' }, { value: '서초', label: '서초' }, { value: '기타', label: '기타' }]}
                value={[{ value: '의정부', label: '의정부' }, { value: '서초', label: '서초' }, { value: '기타', label: '기타' }].find(o => o.value === cardFilterBranch) || { value: '', label: '전체 지사' }}
                onChange={(o: any) => { setCardFilterBranch(o?.value || ''); setCardFilterUser(''); }} isClearable />
            </div>
            <div style={{ minWidth: 180 }}>
              <Select size="sm"
                options={[{ value: '', label: '전체 담당자' }, ...users.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` }))]}
                value={users.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` })).find(o => o.value === cardFilterUser) || { value: '', label: '전체 담당자' }}
                onChange={(o: any) => setCardFilterUser(o?.value || '')} isClearable isSearchable />
            </div>
          </div>

          {/* 미리보기 (업로드 전 확인) */}
          {previewRows && (
            <div className="card" style={{ marginBottom: 16, padding: 20, border: '2px solid #1a73e8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <h4 style={{ margin: 0, color: '#1a73e8', fontSize: '0.95rem' }}>업로드 미리보기</h4>
                  <span style={{ fontSize: '0.75rem', color: '#5f6368' }}>{previewRows.length}건 감지됨</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={handleConfirmUpload} disabled={uploading}>
                    {uploading ? '저장 중...' : `${previewRows.length}건 저장`}
                  </button>
                  <button className="btn btn-sm" onClick={() => setPreviewRows(null)}>취소</button>
                </div>
              </div>
              {excelColumns.length > 0 && (
                <div style={{ fontSize: '0.7rem', color: '#9aa0a6', marginBottom: 10, padding: '6px 10px', background: '#f8f9fa', borderRadius: 6 }}>
                  감지된 컬럼: {excelColumns.join(' | ')}
                </div>
              )}
              <div className="table-wrapper" style={{ maxHeight: 280, overflow: 'auto' }}>
                <table className="data-table" style={{ fontSize: '0.8rem' }}>
                  <thead><tr><th>카드번호</th><th>일자</th><th>가맹점</th><th>금액</th><th>비고</th></tr></thead>
                  <tbody>
                    {previewRows.slice(0, 30).map((r, i) => (
                      <tr key={i} className={i % 2 === 1 ? 'stripe' : ''}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.card_number ? '****' + r.card_number.slice(-4) : <span style={{ color: '#d93025' }}>없음</span>}</td>
                        <td>{r.transaction_date}</td>
                        <td>{r.merchant_name || '-'}</td>
                        <td style={{ fontWeight: 600, color: '#d93025', textAlign: 'right' }}>-{Number(r.amount).toLocaleString()}</td>
                        <td style={{ color: '#9aa0a6' }}>{r.description || '-'}</td>
                      </tr>
                    ))}
                    {previewRows.length > 30 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', color: '#9aa0a6', padding: 8 }}>외 {previewRows.length - 30}건...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 지사별 합산 카드 */}
          {cardSummary.by_branch.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cardSummary.by_branch.length + 1, 4)}, 1fr)`, gap: 10, marginBottom: 16 }}>
              {cardSummary.by_branch.map((b: any) => (
                <div key={b.branch} className="card" style={{ padding: '14px 16px', textAlign: 'center', cursor: 'pointer', border: cardFilterBranch === (b.branch || '기타') ? '2px solid #d93025' : '1px solid var(--gray-200)' }}
                  onClick={() => setCardFilterBranch(cardFilterBranch === (b.branch || '기타') ? '' : (b.branch || '기타'))}>
                  <div style={{ fontSize: '0.72rem', color: '#9aa0a6', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{b.branch || '기타'}</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#d93025', margin: '4px 0' }}>{Number(b.total || 0).toLocaleString()}<span style={{ fontSize: '0.7rem', fontWeight: 400 }}>원</span></div>
                  <div style={{ fontSize: '0.7rem', color: '#9aa0a6' }}>{b.count}건</div>
                </div>
              ))}
              <div className="card" style={{ padding: '14px 16px', textAlign: 'center', background: '#fce4ec', border: '1px solid #f8bbd0' }}>
                <div style={{ fontSize: '0.72rem', color: '#9aa0a6', textTransform: 'uppercase', letterSpacing: '0.5px' }}>합계</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#d93025', margin: '4px 0' }}>
                  {cardSummary.by_branch.reduce((s: number, b: any) => s + Number(b.total || 0), 0).toLocaleString()}<span style={{ fontSize: '0.7rem', fontWeight: 400 }}>원</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#9aa0a6' }}>{cardSummary.by_branch.reduce((s: number, b: any) => s + Number(b.count || 0), 0)}건</div>
              </div>
            </div>
          )}

          {/* 담당자별 사용금액 */}
          {cardSummary.by_user.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', color: '#3c4043' }}>담당자별 사용금액</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {cardSummary.by_user.map((u: any) => (
                  <div key={u.user_id} onClick={() => setCardFilterUser(cardFilterUser === u.user_id ? '' : u.user_id)}
                    style={{ padding: '5px 10px', background: cardFilterUser === u.user_id ? '#1a1a2e' : '#f8f9fa', color: cardFilterUser === u.user_id ? '#fff' : '#3c4043',
                      borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s', border: '1px solid', borderColor: cardFilterUser === u.user_id ? '#1a1a2e' : '#e8eaed' }}>
                    <strong>{u.user_name}</strong>
                    <span style={{ marginLeft: 6, color: cardFilterUser === u.user_id ? '#ffa4a4' : '#d93025', fontWeight: 600 }}>{Number(u.total || 0).toLocaleString()}원</span>
                    <span style={{ marginLeft: 3, opacity: 0.6, fontSize: '0.68rem' }}>{u.count}건</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 거래내역 테이블 */}
          <div className="table-wrapper">
            <table className="data-table" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th style={{ width: '10%' }}>일자</th>
                  <th style={{ width: '12%' }}>카드번호</th>
                  <th style={{ width: '12%' }}>담당자</th>
                  <th style={{ width: '8%' }}>지사</th>
                  <th>가맹점</th>
                  <th style={{ width: '14%', textAlign: 'right' }}>금액</th>
                  <th style={{ width: '12%' }}>비고</th>
                  {canModify && <th style={{ width: '5%' }}></th>}
                </tr>
              </thead>
              <tbody>
                {cardTxns.map((t: any, i: number) => (
                  <tr key={t.id} style={{ background: i % 2 === 1 ? '#fafbfc' : undefined }}>
                    <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                    <td style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#5f6368' }}>
                      {t.card_number ? '****' + String(t.card_number).slice(-4) : '-'}
                    </td>
                    <td>
                      {t.user_name
                        ? <span style={{ fontWeight: 500 }}>{t.user_name}</span>
                        : <span style={{ color: '#bdc1c6', fontSize: '0.75rem' }}>미매칭</span>}
                    </td>
                    <td>
                      <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                        background: t.category === '의정부' ? '#e8f0fe' : t.category === '서초' ? '#fff3e0' : '#f5f5f5',
                        color: t.category === '의정부' ? '#1a73e8' : t.category === '서초' ? '#e65100' : '#9aa0a6' }}>
                        {t.category}
                      </span>
                    </td>
                    <td style={{ color: '#3c4043' }}>{t.merchant_name || '-'}</td>
                    <td style={{ fontWeight: 600, color: '#d93025', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      -{Number(t.amount || 0).toLocaleString()}원
                    </td>
                    <td style={{ fontSize: '0.72rem', color: '#9aa0a6' }}>{t.description || '-'}</td>
                    {canModify && (
                      <td style={{ textAlign: 'center' }}>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bdc1c6', padding: 2, borderRadius: 4, transition: 'color 0.15s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#d93025')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#bdc1c6')}
                          onClick={async () => {
                            if (!confirm('이 건을 삭제하시겠습니까?')) return;
                            try { await api.card.deleteTransaction(t.id); loadCard(); } catch (err: any) { alert(err.message); }
                          }} title="삭제">
                          <X size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {cardTxns.length === 0 && (
                  <tr><td colSpan={canModify ? 8 : 7} style={{ textAlign: 'center', color: '#9aa0a6', padding: 40 }}>
                    {cardMonth ? `${cardMonth} 카드사용 내역이 없습니다.` : '카드사용 내역이 없습니다. 엑셀을 업로드하세요.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
