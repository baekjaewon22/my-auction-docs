import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';

type BonusRow = {
  user_id: string;
  name: string;
  position: string;
  org: string;
  performance_bonus: number;
  myungdo_bonus: number;
  contract_award: number;
  extra_bonus: number;
  extra_label: string;
  total_bonus: number;
};

function fmt(n: number): string { return (n || 0).toLocaleString('ko-KR'); }
function parseMoney(value: unknown): number {
  return Number(String(value ?? '').replace(/[^0-9-]/g, '')) || 0;
}

export default function EmployeeBonusTab({ month, users }: { month: string; users: User[] }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BonusRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [year, monthText] = month.split('-');
      const monthNumber = Number(monthText);
      const isPayoutMonth = monthNumber % 2 === 0;
      let myungdoByUser: Record<string, number> = {};

      if (isPayoutMonth) {
        try {
          const period = `${year}-${String(monthNumber - 1).padStart(2, '0')}_${String(monthNumber).padStart(2, '0')}`;
          const bonusRes = await api.cases.bonusSummary(period);
          myungdoByUser = Object.fromEntries(
            (bonusRes.summary || []).map((item: any) => [item.consultant_user_id, item.bonus || 0])
          );
        } catch {
          myungdoByUser = {};
        }
      }

      const loaded = await Promise.all(users.map(async (user) => {
        try {
          const payroll = await api.payroll.get(user.id, month);
          if (payroll.accounting?.pay_type === 'commission') return null;

          let saved: any = {};
          try {
            const saveRes = await api.payroll.getSave(user.id, payroll.period_label || month);
            saved = saveRes.save ? JSON.parse(saveRes.save.data || '{}') : {};
          } catch {
            saved = {};
          }

          const performanceBonus = payroll.summary?.bonus || 0;
          const contractAward = payroll.is_payout_month && payroll.contract_award?.rank
            ? (payroll.contract_award.award || 0)
            : 0;
          const myungdoBonus = isPayoutMonth ? (myungdoByUser[user.id] || 0) : 0;
          const extraBonus = parseMoney(saved.extraPay);
          const totalBonus = performanceBonus + myungdoBonus + contractAward + extraBonus;

          if (totalBonus <= 0) return null;

          const branch = payroll.user?.branch || user.branch || '';
          const department = payroll.user?.department || user.department || '';
          return {
            user_id: user.id,
            name: payroll.user?.name || user.name,
            position: payroll.user?.position_title || user.position_title || '',
            org: [branch, department].filter(Boolean).join(' · '),
            performance_bonus: performanceBonus,
            myungdo_bonus: myungdoBonus,
            contract_award: contractAward,
            extra_bonus: extraBonus,
            extra_label: saved.extraLabel || '',
            total_bonus: totalBonus,
          } satisfies BonusRow;
        } catch {
          return null;
        }
      }));

      setRows(loaded.filter(Boolean) as BonusRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month, users]);

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      performance_bonus: acc.performance_bonus + row.performance_bonus,
      myungdo_bonus: acc.myungdo_bonus + row.myungdo_bonus,
      contract_award: acc.contract_award + row.contract_award,
      extra_bonus: acc.extra_bonus + row.extra_bonus,
      total_bonus: acc.total_bonus + row.total_bonus,
    }),
    { performance_bonus: 0, myungdo_bonus: 0, contract_award: 0, extra_bonus: 0, total_bonus: 0 }
  ), [rows]);

  const exportExcel = async () => {
    if (rows.length === 0) { alert('다운로드할 상여 내역이 없습니다.'); return; }

    const XLSX = await import('xlsx');
    const [yy, mmText] = month.split('-');
    const mm = Number(mmText);
    const sheetRows = rows.map((row, i) => [
      i + 1,
      row.name,
      row.position,
      row.org,
      row.performance_bonus,
      row.myungdo_bonus,
      row.contract_award,
      row.extra_bonus,
      row.extra_label,
      row.total_bonus,
    ]);

    const sheetData = [
      ['정직원 상여 지급내역'],
      [`기준월: ${yy}년 ${mm}월`, `작성일: ${new Date().toISOString().slice(0, 10)}`, `인원: ${rows.length}명`],
      [],
      ['No', '이름', '직급', '소속', '성과금', '명도포상', '계약포상', '기타포상', '기타포상명', '상여 총금액'],
      ...sheetRows,
      [],
      ['합계', '', '', '', totals.performance_bonus, totals.myungdo_bonus, totals.contract_award, totals.extra_bonus, '', totals.total_bonus],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 16 },
    ];

    const firstDataRow = 5;
    const lastDataRow = firstDataRow + sheetRows.length - 1;
    for (let r = firstDataRow; r <= lastDataRow; r += 1) {
      ['E', 'F', 'G', 'H', 'J'].forEach((col) => {
        const cell = ws[`${col}${r}`];
        if (cell) cell.z = '#,##0';
      });
    }
    const totalRow = firstDataRow + sheetRows.length + 1;
    ['E', 'F', 'G', 'H', 'J'].forEach((col) => {
      const cell = ws[`${col}${totalRow}`];
      if (cell) cell.z = '#,##0';
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '정직원 상여');
    XLSX.writeFile(wb, `정직원_상여내역_${month}.xlsx`);
  };

  return (
    <div className="business-income-tab">
      <div className="bi-head">
        <div className="bi-head-info">
          <FileText size={16} color="#7b1fa2" />
          <strong>{month}</strong> 정직원 성과금내역
          <span className="bi-head-count">{rows.length}명</span>
        </div>
        <div className="bi-head-actions">
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'drive-spin' : ''} /> 새로고침
          </button>
          <button className="btn btn-sm" onClick={exportExcel} disabled={loading || rows.length === 0} title="월별 정직원 상여 엑셀 다운로드">
            <Download size={13} /> 엑셀 저장
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bi-empty">로딩중...</div>
      ) : rows.length === 0 ? (
        <div className="bi-empty">상여 지급 내역이 없습니다.</div>
      ) : (
        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>이름</th>
                <th style={{ width: 120 }}>직급</th>
                <th>소속</th>
                <th style={{ width: 120, textAlign: 'right' }}>성과금</th>
                <th style={{ width: 120, textAlign: 'right' }}>명도포상</th>
                <th style={{ width: 120, textAlign: 'right' }}>계약포상</th>
                <th style={{ width: 120, textAlign: 'right' }}>기타포상</th>
                <th style={{ width: 140, textAlign: 'right' }}>상여 총금액</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.name}</td>
                  <td>{row.position || '-'}</td>
                  <td>{row.org || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.performance_bonus)}원</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.myungdo_bonus)}원</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row.contract_award)}원</td>
                  <td style={{ textAlign: 'right' }} title={row.extra_label}>{fmt(row.extra_bonus)}원</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(row.total_bonus)}원</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bi-total">
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>합계</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.performance_bonus)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.myungdo_bonus)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.contract_award)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.extra_bonus)}원</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(totals.total_bonus)}원</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="bi-note">
        · 정직원 급여/직급수당은 제외하고 성과금, 명도포상, 계약포상, 기타포상만 상여로 합산합니다.<br/>
        · 기타포상은 각 담당자 급여정산 저장 내역의 추가 정산 항목을 반영합니다.
      </div>
    </div>
  );
}
