import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import { useAuthStore } from '../store';

type PayrollListRow = {
  user_id: string;
  branch: string;
  department: string;
  name: string;
  position: string;
  pay_type: string;
  base_pay: number;
  salary: number;
  position_allowance: number;
  performance_bonus: number;
  case_allowance: number;
  contract_award: number;
  extra_pay: number;
  deduction: number;
  total_pay: number;
};

function fmt(n: number): string { return (n || 0).toLocaleString('ko-KR'); }
function truncMoney(n: number): number { return Math.trunc((Number(n) || 0) / 10) * 10; }
function payrollMoney(n: number, month: string): number {
  return /^\d{4}-\d{2}$/.test(month) && month >= '2026-06'
    ? truncMoney(n)
    : Math.round(Number(n) || 0);
}
function vatSupplyAmount(n: number, month: string): number { return payrollMoney((Number(n) || 0) * 10 / 11, month); }
function parseMoney(value: unknown): number {
  return Number(String(value ?? '').replace(/[^0-9-]/g, '')) || 0;
}

const PAYROLL_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const BRANCH_ORDER = ['의정부', '서초', '대전', '부산', '본사'];
const HQ_DISPLAY_DEPARTMENTS = ['명도팀', 'pd', '법률지원팀', '기획팀'];
const BOTTOM_DISPLAY_DEPARTMENTS = ['명도팀', 'pd', '법률지원팀'];

function canViewAllEmployeePayroll(user?: User | null): boolean {
  if (!user) return false;
  return ['master', 'ceo', 'accountant'].includes(user.role) || PAYROLL_EXTRA_IDS.includes(user.id);
}

function matchesDepartment(value: string, departments: string[]): boolean {
  const text = String(value || '').replace(/\s+/g, '').toLowerCase();
  return departments.some((department) => text.includes(department.replace(/\s+/g, '').toLowerCase()));
}

function isDisplayHqDepartment(value: string): boolean {
  return matchesDepartment(value, HQ_DISPLAY_DEPARTMENTS);
}

function bottomDepartmentSortIndex(value: string): number {
  return matchesDepartment(value, BOTTOM_DISPLAY_DEPARTMENTS) ? 1 : 0;
}

function displayBranchName(value: string, department = ''): string {
  if (isDisplayHqDepartment(department)) return '본사';
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.includes('의정부')) return '의정부';
  if (text.includes('서초')) return '서초';
  if (text.includes('대전')) return '대전';
  if (text.includes('부산')) return '부산';
  if (text.includes('본사')) return '본사';
  return text;
}

function branchSortIndex(value: string): number {
  const idx = BRANCH_ORDER.indexOf(displayBranchName(value));
  return idx === -1 ? 999 : idx;
}

export default function EmployeePayrollListTab({ month, users }: { month: string; users: User[] }) {
  const { user: currentUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PayrollListRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [year, monthText] = month.split('-');
      const monthNumber = Number(monthText);
      const isPayoutMonth = monthNumber % 2 === 0;
      let salaryCaseAllowanceByUser: Record<string, number> = {};

      if (isPayoutMonth) {
        try {
          const period = `${year}-${String(monthNumber - 1).padStart(2, '0')}_${String(monthNumber).padStart(2, '0')}`;
          const salaryBonusRes = await api.cases.bonusSummary(period, { salary_only_month: month });
          salaryCaseAllowanceByUser = Object.fromEntries(
            (salaryBonusRes.summary || []).map((item: any) => [item.consultant_user_id, item.bonus || 0])
          );
        } catch {
          salaryCaseAllowanceByUser = {};
        }
      }

      const loaded = await Promise.all(users.map(async (user) => {
        try {
          const payroll = await api.payroll.get(user.id, month);
          const s = payroll.summary || {};
          const accounting = payroll.accounting || {};

          let saved: any = {};
          try {
            const saveRes = await api.payroll.getSave(user.id, payroll.period_label || month);
            saved = saveRes.save ? JSON.parse(saveRes.save.data || '{}') : {};
          } catch {
            saved = {};
          }

          const salary = Number(s.salary || accounting.salary || 0);
          const positionAllowance = Number(s.position_allowance || accounting.position_allowance || 0);
          const basePay = Number(s.base_pay || salary + positionAllowance);
          const performanceBonus = Number(s.bonus || 0);
          const isCommission = accounting.pay_type === 'commission';
          const liveCaseAllowance = isCommission ? 0 : Number(salaryCaseAllowanceByUser[user.id] || 0);
          const savedCaseAllowance = Number(saved.caseAllowance?.bonus || saved.payroll_snapshot?.caseAllowance?.bonus || 0);
          const caseAllowance = isCommission ? 0 : (savedCaseAllowance || liveCaseAllowance);
          const contractAward = payroll.is_payout_month && payroll.contract_award?.rank
            ? Number(payroll.contract_award.award || 0)
            : 0;
          const manualExtraPay = parseMoney(saved.extraPay);
          const commExtraRaw = Array.isArray(saved.commExtras)
            ? saved.commExtras.reduce((sum: number, item: any) => sum + parseMoney(item?.amount), 0)
            : 0;
          const manualDeduction = parseMoney(saved.deduction)
            + parseMoney(saved.extraDeduction);
          const commDeductionRaw = Array.isArray(saved.commDeductions)
            ? saved.commDeductions.reduce((sum: number, item: any) => sum + parseMoney(item?.amount), 0)
            : 0;
          const deduction = manualDeduction
            + Number(s.unpaid_leave_deduction || 0)
            + Number(payroll.joining_settlement?.base_deduction || 0)
            + Number(payroll.termination_settlement?.base_deduction || 0)
            + Number(payroll.termination_settlement?.leave_deduction || 0)
            + commDeductionRaw;
          const terminationLeavePayout = Number(payroll.termination_settlement?.leave_payout || 0);

          let rowBasePay = basePay;
          let rowPerformanceBonus = performanceBonus;
          let rowCaseAllowance = caseAllowance;
          let rowContractAward = contractAward;
          let rowExtraPay = manualExtraPay + commExtraRaw + terminationLeavePayout;
          let rowDeduction = deduction;
          let totalPay = payrollMoney(rowBasePay - rowDeduction + rowPerformanceBonus + rowCaseAllowance + rowContractAward + rowExtraPay, month);

          if (isCommission) {
            const rate = Number(accounting.commission_rate || 0);
            const normalRecords = (payroll.records || []).filter((r: any) => r.type !== '매수신청대리');
            const normalSupply = normalRecords.reduce((sum: number, r: any) => sum + (Number(r.supply_amount) || vatSupplyAmount(r.amount, month)), 0);
            const normalRefundSupply = (payroll.refunded_records || [])
              .filter((r: any) => r.type !== '매수신청대리')
              .reduce((sum: number, r: any) => sum + vatSupplyAmount(r.amount, month), 0);
            const netNormalSales = normalSupply - normalRefundSupply;
            const commissionAmount = truncMoney(netNormalSales * rate / 100);
            const proxyIncome = (payroll.records || [])
              .filter((r: any) => r.type === '매수신청대리')
              .reduce((sum: number, r: any) => {
                const payrollAmount = vatSupplyAmount(r.amount || 0, month) - (Number(r.proxy_cost) || 0);
                return sum + Math.max(payrollAmount, 0);
              }, 0);
            const extraDetails = Array.isArray(saved.commExtras)
              ? saved.commExtras.map((item: any) => {
                  const raw = parseMoney(item?.amount);
                  return {
                    raw,
                    afterRate: item?.skipRate ? raw : truncMoney(raw * rate / 100),
                    skipTax: !!item?.skipTax,
                  };
                })
              : [];
            const preTaxDeductions = Array.isArray(saved.commDeductions)
              ? saved.commDeductions
                  .filter((item: any) => item?.isFood || item?.skipTax)
                  .reduce((sum: number, item: any) => sum + parseMoney(item?.amount), 0)
              : 0;
            const otherDeductions = Array.isArray(saved.commDeductions)
              ? saved.commDeductions
                  .filter((item: any) => !item?.isFood && !item?.skipTax)
                  .reduce((sum: number, item: any) => sum + parseMoney(item?.amount), 0)
              : 0;
            const totalIncome = commissionAmount + proxyIncome + extraDetails.reduce((sum: number, item: any) => sum + item.afterRate, 0);
            const taxExemptAmount = extraDetails.filter((item: any) => item.skipTax).reduce((sum: number, item: any) => sum + item.afterRate, 0);
            const taxableIncome = totalIncome - taxExemptAmount - preTaxDeductions;
            const tax33 = truncMoney(taxableIncome * 0.033);
            const contractAwardTax = truncMoney(contractAward * 0.033);
            rowBasePay = commissionAmount + proxyIncome;
            rowPerformanceBonus = 0;
            rowCaseAllowance = 0;
            rowContractAward = contractAward;
            rowExtraPay = extraDetails.reduce((sum: number, item: any) => sum + item.afterRate, 0);
            rowDeduction = preTaxDeductions + otherDeductions + tax33 + contractAwardTax;
            totalPay = payrollMoney(rowBasePay - rowDeduction + rowPerformanceBonus + rowCaseAllowance + rowContractAward + rowExtraPay, month);
          }

          return {
            user_id: user.id,
            branch: displayBranchName(payroll.user?.branch || user.branch || '', payroll.user?.department || user.department || ''),
            department: payroll.user?.department || user.department || '',
            name: payroll.user?.name || user.name,
            position: payroll.user?.position_title || user.position_title || '',
            pay_type: isCommission ? '비율제' : '급여제',
            base_pay: rowBasePay,
            salary,
            position_allowance: positionAllowance,
            performance_bonus: rowPerformanceBonus,
            case_allowance: rowCaseAllowance,
            contract_award: rowContractAward,
            extra_pay: rowExtraPay,
            deduction: rowDeduction,
            total_pay: totalPay,
          } satisfies PayrollListRow;
        } catch {
          return null;
        }
      }));

      setRows((loaded.filter(Boolean) as PayrollListRow[]).sort((a, b) => (
        bottomDepartmentSortIndex(a.department) - bottomDepartmentSortIndex(b.department)
        || branchSortIndex(a.branch) - branchSortIndex(b.branch)
        || a.branch.localeCompare(b.branch, 'ko')
        || a.department.localeCompare(b.department, 'ko')
        || a.name.localeCompare(b.name, 'ko')
      )));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month, users]);

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      base_pay: acc.base_pay + row.base_pay,
      performance_bonus: acc.performance_bonus + row.performance_bonus,
      case_allowance: acc.case_allowance + row.case_allowance,
      contract_award: acc.contract_award + row.contract_award,
      extra_pay: acc.extra_pay + row.extra_pay,
      deduction: acc.deduction + row.deduction,
      total_pay: acc.total_pay + row.total_pay,
    }),
    { base_pay: 0, performance_bonus: 0, case_allowance: 0, contract_award: 0, extra_pay: 0, deduction: 0, total_pay: 0 }
  ), [rows]);

  const exportExcel = async () => {
    if (rows.length === 0) { alert('다운로드할 급여 내역이 없습니다.'); return; }

    const XLSX = await import('xlsx');
    const sheetRows = rows.map((row, i) => [
      i + 1,
      row.branch,
      row.name,
      row.position,
      row.pay_type,
      row.base_pay,
      row.performance_bonus,
      row.case_allowance,
      row.contract_award,
      row.extra_pay,
      row.deduction,
      row.total_pay,
    ]);
    const sheetData = [
      ['전직원 급여 내역'],
      [`기준월: ${month}`, `작성일: ${new Date().toISOString().slice(0, 10)}`, `인원: ${rows.length}명`],
      [],
      ['No', '지사', '담당자', '직급', '정산유형', '급여', '성과금', '안건 수당', '계약포상', '기타지급', '공제', '총지급금'],
      ...sheetRows,
      [],
      ['합계', '', '', '', '', totals.base_pay, totals.performance_bonus, totals.case_allowance, totals.contract_award, totals.extra_pay, totals.deduction, totals.total_pay],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    ];
    const firstDataRow = 5;
    const totalRow = firstDataRow + sheetRows.length + 1;
    for (let r = firstDataRow; r <= totalRow; r += 1) {
      ['F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) => {
        const cell = ws[`${col}${r}`];
        if (cell) cell.z = '#,##0';
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '전직원 급여');
    XLSX.writeFile(wb, `전직원_급여내역_${month}.xlsx`);
  };

  return (
    <div className="business-income-tab">
      {!canViewAllEmployeePayroll(currentUser) ? (
        <div className="bi-empty">전직원 급여 내역 열람 권한이 없습니다.</div>
      ) : (
      <>
      <div className="bi-head">
        <div className="bi-head-info">
          <FileText size={16} color="#1a73e8" />
          <strong>{month}</strong> 전직원 급여 내역
          <span className="bi-head-count">{rows.length}명</span>
        </div>
        <div className="bi-head-actions">
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'drive-spin' : ''} /> 새로고침
          </button>
          <button className="btn btn-sm" onClick={exportExcel} disabled={loading || rows.length === 0} title="월별 전직원 급여 엑셀 다운로드">
            <Download size={13} /> 엑셀 저장
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bi-empty">로딩중...</div>
      ) : rows.length === 0 ? (
        <div className="bi-empty">급여 내역이 없습니다.</div>
      ) : (
        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>지사</th>
                <th style={{ width: 110 }}>담당자</th>
                <th style={{ width: 110 }}>직급</th>
                <th style={{ width: 90 }}>유형</th>
                <th style={{ width: 120, textAlign: 'right' }}>급여</th>
                <th style={{ width: 120, textAlign: 'right' }}>성과금</th>
                <th style={{ width: 120, textAlign: 'right' }}>안건 수당</th>
                <th style={{ width: 120, textAlign: 'right' }}>계약포상</th>
                <th style={{ width: 120, textAlign: 'right' }}>기타/공제</th>
                <th style={{ width: 140, textAlign: 'right' }}>총지급금</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.branch || '-'}</td>
                  <td>{row.name}</td>
                  <td>{row.position || '-'}</td>
                  <td>{row.pay_type}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.base_pay)}원</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.performance_bonus)}원</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.case_allowance)}원</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.contract_award)}원</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.extra_pay - row.deduction)}원</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(row.total_pay)}원</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bi-total">
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>합계</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.base_pay)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.performance_bonus)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.case_allowance)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.contract_award)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.extra_pay - totals.deduction)}원</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(totals.total_pay)}원</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  );
}
