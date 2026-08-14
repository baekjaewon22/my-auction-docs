import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { sameBranchName } from '../lib/branchAliases';
import { groupUserOptions } from '../lib/userSelectOptions';

type UnifiedBidRow = {
  id: string;
  user_id: string;
  owner_name?: string;
  owner_branch?: string;
  owner_position_title?: string;
  bid_date: string;
  court: string;
  case_number: string;
  item_no: string;
  client_name: string;
  bidder_name: string;
  property_type: string;
  suggested_price: number | null;
  actual_bid_price: number | null;
  winning_price: number | null;
  bid_result: string;
  sales_record_id?: string;
  sales_status?: string;
  sales_amount?: number;
  source_type?: 'legacy' | 'auction_schedule';
  schedule_id?: string;
};

function money(value: number | null | undefined): string {
  return value && Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR') : '-';
}

function resultClass(result: string): string {
  if (result === '낙찰') return 'won';
  if (result === '취소') return 'cancelled';
  if (result === '대기') return 'pending';
  return 'failed';
}

export default function UnifiedBidHistory() {
  const [rows, setRows] = useState<UnifiedBidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [filterOptions, setFilterOptions] = useState<{
    branches: Array<{ branch: string }>;
    assignees: Array<{ id: string; name: string; branch: string }>;
  }>({ branches: [], assignees: [] });

  const assigneeOptions = branchFilter
    ? filterOptions.assignees.filter((item) => sameBranchName(item.branch, branchFilter))
    : filterOptions.assignees;
  const assigneeGroups = useMemo(
    () => groupUserOptions(assigneeOptions, (item) => item.branch ? ` (${item.branch})` : ''),
    [assigneeOptions],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.freelancerBids.list({ branch: branchFilter, assignee: assigneeFilter })
      .then((response) => {
        if (!active) return;
        setRows(response.rows as UnifiedBidRow[]);
        if (response.filters) setFilterOptions(response.filters);
      })
      .catch((err: any) => { if (active) setError(err.message || '입찰 내역을 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [branchFilter, assigneeFilter]);

  return (
    <div className="page-container freelancer-bid-page unified-bid-history-page">
      <div className="page-header compact">
        <div>
          <h1>입찰 내역</h1>
          <p>경매 스케줄의 입찰 카드를 관리자용 목록으로 조회합니다.</p>
        </div>
        <Link className="btn btn-primary" to="/auction-schedule">
          <CalendarDays size={16} /> 경매 스케줄
        </Link>
      </div>

      <div className="info-box" style={{ marginBottom: 16 }}>
        작성과 결과 처리는 경매 스케줄에서 진행합니다. 전환 전 기존 입찰 기록도 보존하여 같은 목록에 표시합니다.
      </div>

      <div className="freelancer-bid-filter-bar">
          <label>
            <span>지사</span>
            <select value={branchFilter} onChange={(event) => { setBranchFilter(event.target.value); setAssigneeFilter(''); }}>
              <option value="">전체 지사</option>
              {filterOptions.branches.map((item) => <option key={item.branch} value={item.branch}>{item.branch}</option>)}
            </select>
          </label>
          <label>
            <span>담당자</span>
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
              <option value="">전체 담당자</option>
              {assigneeGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {loading ? <div className="empty-state">불러오는 중입니다.</div> : rows.length === 0 ? (
        <div className="empty-state">조회할 입찰 내역이 없습니다.</div>
      ) : (
        <div className="freelancer-bid-table-wrap">
          <table className="freelancer-bid-table">
            <thead>
              <tr>
                <th>입찰일</th>
                <th>지사</th>
                <th>담당자</th>
                <th>법원</th>
                <th>사건번호</th>
                <th>계약자명</th>
                <th>입찰자명</th>
                <th>물건종류</th>
                <th>제안입찰가</th>
                <th>작성입찰가</th>
                <th>최종 낙찰가</th>
                <th>결과</th>
                <th>원본</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.bid_date}</td>
                  <td>{row.owner_branch || '-'}</td>
                  <td><strong>{row.owner_name || '-'}</strong>{row.owner_position_title ? <span className="subtle-text"> · {row.owner_position_title}</span> : null}</td>
                  <td>{row.court || '-'}</td>
                  <td><strong>{row.case_number || '-'}</strong>{row.item_no ? <span className="subtle-text"> 물건 {row.item_no}</span> : null}</td>
                  <td>{row.client_name || '-'}</td>
                  <td>{row.bidder_name || '-'}</td>
                  <td>{row.property_type || '-'}</td>
                  <td>{money(row.suggested_price)}</td>
                  <td>{money(row.actual_bid_price)}</td>
                  <td>{money(row.winning_price)}</td>
                  <td>
                    <span className={`bid-result-pill ${resultClass(row.bid_result)}`}>{row.bid_result || '대기'}</span>
                    {row.sales_record_id ? (
                      <Link className="subtle-text" style={{ display: 'block', marginTop: 4 }} to={`/sales?focus=sales&id=${row.sales_record_id}`}>
                        입금내역 {money(row.sales_amount)}원
                      </Link>
                    ) : null}
                  </td>
                  <td>
                    {row.source_type === 'auction_schedule' && row.schedule_id ? (
                      <Link className="btn btn-sm" to={`/auction-schedule?date=${row.bid_date}&schedule=${row.schedule_id}`}>
                        <ExternalLink size={13} /> 스케줄
                      </Link>
                    ) : <span className="subtle-text">기존 기록</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
