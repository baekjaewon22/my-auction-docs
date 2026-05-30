import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';
import { api } from '../api';

type MissingUser = Awaited<ReturnType<typeof api.sales.missingDocuments>>['users'][number];

function fmtWon(value: number): string {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

export default function MissingDocuments() {
  const [month, setMonth] = useState('');
  const [rows, setRows] = useState<MissingUser[]>([]);
  const [totals, setTotals] = useState({ consultants: 0, contract_missing: 0, property_report_missing: 0, total_missing: 0 });
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.sales.missingDocuments({ month });
      setRows(res.users || []);
      setTotals(res.totals || { consultants: 0, contract_missing: 0, property_report_missing: 0, total_missing: 0 });
    } catch (err: any) {
      alert(err.message || '미제출 현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(row =>
      row.user_name.toLowerCase().includes(q) ||
      row.position_title.toLowerCase().includes(q) ||
      row.branch.toLowerCase().includes(q) ||
      row.department.toLowerCase().includes(q) ||
      row.records.some(r => r.client_name.toLowerCase().includes(q))
    );
  }, [rows, query]);

  return (
    <div className="page missing-documents-page">
      <div className="page-header">
        <div>
          <h2><FileText size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 미제출 문서 현황</h2>
          <p className="management-support-subtitle">컨설팅 계약서와 물건분석보고서 미제출 건을 담당자별로 집계합니다.</p>
        </div>
        <Link to="/sales" className="btn">업무성과로 이동</Link>
      </div>

      <section className="missing-docs-kpis">
        <div><span>대상 담당자</span><strong>{totals.consultants.toLocaleString('ko-KR')}명</strong></div>
        <div><span>컨설팅 계약서</span><strong>{totals.contract_missing.toLocaleString('ko-KR')}건</strong></div>
        <div><span>물건분석보고서</span><strong>{totals.property_report_missing.toLocaleString('ko-KR')}건</strong></div>
        <div className="danger"><span>총 미제출</span><strong>{totals.total_missing.toLocaleString('ko-KR')}건</strong></div>
      </section>

      <section className="missing-docs-toolbar">
        <label>
          <span>계약월</span>
          <input type="month" className="form-input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" className="btn" onClick={() => setMonth('')}>전체기간</button>
        <label className="missing-docs-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="담당자, 지사, 팀, 계약자 검색" />
        </label>
      </section>

      <section className="card missing-docs-card">
        {loading ? (
          <div className="empty-state">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">미제출 문서가 없습니다.</div>
        ) : (
          <div className="missing-docs-table-wrap">
            <table className="missing-docs-table">
              <thead>
                <tr>
                  <th>담당자</th>
                  <th>소속</th>
                  <th>컨설팅 계약서</th>
                  <th>물건분석보고서</th>
                  <th>합계</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const isOpen = !!open[row.user_id];
                  return (
                    <>
                      <tr key={row.user_id} className={row.total_missing > 0 ? 'has-missing' : ''}>
                        <td>
                          <strong>{row.user_name}</strong>
                          {row.position_title && <span>{row.position_title}</span>}
                        </td>
                        <td>{row.branch || '-'} · {row.department || '-'}</td>
                        <td>{row.contract_missing ? `${row.contract_missing}건 미제출` : '-'}</td>
                        <td>{row.property_report_missing ? `${row.property_report_missing}건 미제출` : '-'}</td>
                        <td><b>{row.total_missing}건</b></td>
                        <td>
                          <button type="button" className="btn btn-sm" onClick={() => setOpen(prev => ({ ...prev, [row.user_id]: !isOpen }))}>
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} 열람
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${row.user_id}-detail`} className="missing-docs-detail-row">
                          <td colSpan={6}>
                            <div className="missing-docs-detail-list">
                              {row.records.map(record => (
                                <Link key={record.id} to={`/sales?record=${record.id}`} className="missing-docs-detail-item">
                                  <AlertTriangle size={14} />
                                  <span>{record.doc_type}</span>
                                  <strong>{record.client_name || '계약자 미기재'}</strong>
                                  <span>{record.contract_date || '-'}</span>
                                  <span>{fmtWon(record.amount)}</span>
                                </Link>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
