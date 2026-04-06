import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { DollarSign, CheckCircle, Clock } from 'lucide-react';

interface Commission {
  id: string;
  journal_entry_id: string;
  user_id: string;
  user_name: string;
  user_display_name: string;
  client_name: string;
  case_no: string;
  win_price: string;
  status: 'pending' | 'completed';
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  department?: string;
  branch?: string;
}

function dDay(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const diff = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function fmtCurrency(val: string) {
  const num = (val || '').replace(/[^0-9]/g, '');
  return num ? Number(num).toLocaleString() + '원' : '-';
}

export default function Commissions() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const canComplete = ['master', 'ceo', 'cc_ref'].includes(user?.role || '');

  const load = async () => {
    try {
      const res = await api.commissions.list();
      setItems(res.commissions);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleComplete = async (id: string, userName: string) => {
    if (!confirm(`${userName}님의 수수료를 입금완료 처리하시겠습니까?`)) return;
    try {
      await api.commissions.complete(id);
      load();
    } catch (err: any) { alert(err.message); }
  };

  const filtered = items.filter(i => {
    if (filter === 'pending') return i.status === 'pending';
    if (filter === 'completed') return i.status === 'completed';
    return true;
  });

  const pendingCount = items.filter(i => i.status === 'pending').length;

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><DollarSign size={20} style={{ marginRight: 6, verticalAlign: 'middle' }} />수수료 관리</h2>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>미정산 <b style={{ color: '#d93025' }}>{pendingCount}</b>건</span>
      </div>

      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <button className={`filter-btn ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>미정산</button>
        <button className={`filter-btn ${filter === 'completed' ? 'active' : ''}`} onClick={() => setFilter('completed')}>완료</button>
        <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>전체</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          {filter === 'pending' ? '미정산 수수료가 없습니다.' : '항목이 없습니다.'}
        </div>
      ) : (
        <div className="commission-table-wrap">
          <table className="commission-table">
            <thead>
              <tr>
                <th>담당자</th>
                <th>고객명</th>
                <th>사건번호</th>
                <th>낙찰가</th>
                <th>D-DAY</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const days = dDay(item.created_at);
                const isPending = item.status === 'pending';
                return (
                  <tr key={item.id} className={isPending ? '' : 'commission-completed'}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.user_display_name || item.user_name}</div>
                      {item.department && <div style={{ fontSize: '0.68rem', color: '#888' }}>{item.department}</div>}
                    </td>
                    <td>{item.client_name || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{item.case_no || '-'}</td>
                    <td style={{ fontWeight: 600 }}>{fmtCurrency(item.win_price)}</td>
                    <td>
                      {isPending ? (
                        <span className={`commission-dday ${days > 30 ? 'danger' : days > 14 ? 'warn' : ''}`}>
                          D+{days}
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: '#888' }}>
                          {item.completed_at ? new Date(item.completed_at).toLocaleDateString('ko-KR') : '-'}
                        </span>
                      )}
                    </td>
                    <td>
                      {isPending ? (
                        canComplete ? (
                          <button className="btn btn-sm btn-primary" onClick={() => handleComplete(item.id, item.user_display_name || item.user_name)}>
                            <CheckCircle size={13} /> 입금완료
                          </button>
                        ) : (
                          <span className="commission-status-pending"><Clock size={12} /> 미정산</span>
                        )
                      ) : (
                        <span className="commission-status-done"><CheckCircle size={12} /> 완료</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
