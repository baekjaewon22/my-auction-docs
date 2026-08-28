import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api, type ExpenseReceiptArchiveItem } from '../api';
import { useAuthStore } from '../store';
import { useBranches } from '../hooks/useBranches';
import { formatExpenseReceiptBytes, formatExpenseReceiptDateTime } from '../lib/expense-receipt';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '작성중', className: 'status-draft' },
  submitted: { label: '승인 대기', className: 'status-submitted' },
  approved: { label: '승인', className: 'status-approved' },
  rejected: { label: '반려', className: 'status-rejected' },
  cancel_requested: { label: '취소 신청', className: 'status-cancel-req' },
  cancelled: { label: '취소', className: 'status-cancelled' },
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '지출결의 결재 관리를 불러오지 못했습니다.';
}

// 승인/반려/취소 처리 이력 한 줄 요약
function historyLine(item: ExpenseReceiptArchiveItem): { icon: 'approved' | 'rejected' | 'cancelled' | 'pending' | 'draft'; text: string } {
  if (item.cancelled) {
    return { icon: 'cancelled', text: `취소 처리${item.cancel_reason ? ` · 사유: ${item.cancel_reason}` : ''}` };
  }
  if (item.cancel_requested) {
    return { icon: 'pending', text: `취소 승인 대기${item.cancel_reason ? ` · 사유: ${item.cancel_reason}` : ''}` };
  }
  if (item.status === 'approved') {
    const who = item.last_actor_name ? ` · 처리 ${item.last_actor_name}(${item.last_actor_role})` : '';
    const when = item.last_action_at ? ` · ${formatExpenseReceiptDateTime(item.last_action_at)}` : '';
    return { icon: 'approved', text: `승인 완료${who}${when}` };
  }
  if (item.status === 'rejected') {
    const reason = item.reject_reason || item.last_action_comment;
    const who = item.last_actor_name ? ` · 반려 ${item.last_actor_name}(${item.last_actor_role})` : '';
    const when = item.last_action_at ? ` · ${formatExpenseReceiptDateTime(item.last_action_at)}` : '';
    return { icon: 'rejected', text: `반려${who}${reason ? ` · 사유: ${reason}` : ''}${when}` };
  }
  if (item.status === 'submitted') {
    return { icon: 'pending', text: '대표이사 결재 대기 중' };
  }
  return { icon: 'draft', text: '작성 중 (미제출)' };
}

export default function ExpenseReceiptApprovalManage() {
  const { user } = useAuthStore();
  const { branches } = useBranches();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpenseReceiptArchiveItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [status, setStatus] = useState('');
  const [month, setMonth] = useState('');
  const [branch, setBranch] = useState('');
  const [author, setAuthor] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [downloadingId, setDownloadingId] = useState('');

  const isFreelancer = user?.login_type === 'freelancer' && user.role !== 'master';
  const canViewAll = Boolean(user && !isFreelancer
    && ['master', 'ceo', 'accountant', 'accountant_asst'].includes(user.role));
  const isMaster = user?.role === 'master';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.expenseReceipts.list({
        page,
        page_size: pageSize,
        status,
        month,
        branch,
        author,
        search: search.trim(),
      });
      setItems(response.items || []);
      setTotal(response.total || 0);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, status, month, branch, author, search]);

  useEffect(() => {
    if (!canViewAll) { setLoading(false); return; }
    const timer = window.setTimeout(load, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search, canViewAll]);

  const downloadPdf = async (item: ExpenseReceiptArchiveItem) => {
    setDownloadingId(item.document_id);
    setError('');
    try {
      await api.expenseReceipts.downloadPdf(item.document_id, `${item.created_at.slice(0, 10)}-${item.author_name || '지출'}-영수증-지출결의서.pdf`);
    } catch (downloadError) {
      setError(errorText(downloadError));
    } finally {
      setDownloadingId('');
    }
  };

  const handleDelete = async (item: ExpenseReceiptArchiveItem) => {
    if (!confirm(`'${item.title || '영수증 첨부 지출결의서'}' (${STATUS_CONFIG[item.status]?.label || item.status}) 문서를 삭제할까요?\n작성중·반려 상태만 삭제할 수 있으며 되돌릴 수 없습니다.`)) return;
    setDeletingId(item.document_id);
    setError('');
    setNotice('');
    try {
      await api.documents.delete(item.document_id);
      setNotice('삭제했습니다.');
      await load();
    } catch (deleteError) {
      setError(errorText(deleteError));
    } finally {
      setDeletingId('');
    }
  };

  if (!canViewAll) {
    return (
      <div className="page">
        <div className="empty-state"><ShieldCheck size={20} /> 지출결의 결재 관리 열람 권한이 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="page expense-receipt-archive-page">
      <nav className="archive-category-tabs" aria-label="문서보관함 하위 카테고리">
        <button type="button" onClick={() => navigate('/archive')}><FileText size={16} /> 결재문서</button>
        <button type="button" onClick={() => navigate('/archive?category=expense-receipts')}><Receipt size={16} /> 영수증 지출결의</button>
        <button type="button" className="active"><ShieldCheck size={16} /> 지출결의 결재관리</button>
      </nav>

      <header className="expense-receipt-archive-header">
        <div>
          <h2><ShieldCheck size={24} /> 지출결의 결재 관리</h2>
          <p>제출·승인·반려·취소를 포함한 전체 지출결의의 결재 이력을 확인하고 관리합니다.</p>
        </div>
        <div>
          <button type="button" className="btn" onClick={load} disabled={loading}><RefreshCw size={15} /> 새로고침</button>
        </div>
      </header>

      {error && <div className="alert alert-error"><AlertTriangle size={17} /> {error}</div>}
      {notice && <div className="alert alert-success"><CheckCircle2 size={17} /> {notice}</div>}

      <section className="expense-receipt-archive-summary">
        <div><span>검색 결과</span><strong>{total}건</strong></div>
        <div><span>승인 대기</span><strong>{items.filter((i) => i.status === 'submitted' && !i.cancelled && !i.cancel_requested).length}건</strong><small>현재 페이지</small></div>
        <div><span>반려</span><strong>{items.filter((i) => i.status === 'rejected').length}건</strong><small>현재 페이지</small></div>
        <div><span>승인 완료</span><strong>{items.filter((i) => i.status === 'approved' && !i.cancelled).length}건</strong><small>현재 페이지</small></div>
      </section>

      <section className="expense-receipt-archive-filters" aria-label="결재 관리 필터">
        <label><span>상태</span><select className="form-input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">전체 상태</option><option value="submitted">승인 대기</option><option value="approved">승인</option><option value="rejected">반려</option><option value="cancel_requested">취소 신청</option><option value="cancelled">취소</option><option value="draft">작성중</option></select></label>
        <label><span>월</span><input type="month" className="form-input" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }} /></label>
        <label><span>지사</span><select className="form-input" value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }}><option value="">전체 지사</option>{branches.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label><span>작성자</span><input className="form-input" value={author} onChange={(event) => { setAuthor(event.target.value); setPage(1); }} placeholder="작성자명" /></label>
        <label className="expense-receipt-archive-search"><span>검색</span><div><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="제목·작성자·부서 검색" /></div></label>
      </section>

      {loading ? (
        <div className="page-loading">결재 내역을 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">조건에 맞는 지출결의서가 없습니다.</div>
      ) : (
        <div className="expense-receipt-archive-list">
          {items.map((item) => {
            const effectiveStatus = item.cancelled ? 'cancelled' : item.cancel_requested ? 'cancel_requested' : item.status;
            const statusInfo = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.draft;
            const history = historyLine(item);
            // 마스터는 상태와 무관하게 삭제 가능(강제 삭제). 그 외에는 본인 작성 초안·반려만.
            const canDelete = isMaster
              || (['draft', 'rejected'].includes(item.status) && !item.cancelled && item.author_id === user?.id);
            return (
              <article className="expense-receipt-archive-item" key={item.document_id}>
                <Link to={`/expense-receipts/${item.document_id}`} className="expense-receipt-archive-main">
                  <div className="expense-receipt-archive-icon"><Receipt size={21} /></div>
                  <div className="expense-receipt-archive-info">
                    <div><strong>{item.title || '영수증 첨부 지출결의서'}</strong><span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span></div>
                    <p>{item.author_name || '작성자 미확인'} · {item.branch || '지사 미지정'} · {item.department || '부서 미지정'}</p>
                    <small>작성 {formatExpenseReceiptDateTime(item.created_at)} · 수정 {formatExpenseReceiptDateTime(item.updated_at)}</small>
                  </div>
                </Link>
                <div className="expense-receipt-archive-state">
                  <span className={history.icon === 'approved' ? 'success' : history.icon === 'rejected' ? 'failed' : ''}>
                    {history.icon === 'approved' ? <CheckCircle2 size={14} />
                      : history.icon === 'rejected' ? <XCircle size={14} />
                        : history.icon === 'cancelled' ? <XCircle size={14} />
                          : <Clock size={14} />}
                    {' '}{history.text}
                  </span>
                  <span><FileCheck size={14} /> 영수증 {item.attachment_count}장 · {formatExpenseReceiptBytes(item.total_file_size)}</span>
                  <span className={item.drive_status === 'failed' ? 'failed' : item.drive_status === 'success' ? 'success' : ''}>
                    <Cloud size={14} /> {item.drive_status === 'success' ? 'Drive 백업 완료' : item.drive_status === 'failed' ? 'Drive 백업 실패' : item.status === 'approved' ? 'Drive 백업 대기' : 'Drive 백업 없음'}
                  </span>
                </div>
                <div className="expense-receipt-archive-actions">
                  <Link className="btn btn-sm" to={`/expense-receipts/${item.document_id}`}>상세·처리</Link>
                  {item.pdf_available && (
                    <button type="button" className="btn btn-sm" onClick={() => downloadPdf(item)} disabled={downloadingId === item.document_id}>
                      <Download size={14} /> {downloadingId === item.document_id ? '받는 중' : '합본 PDF'}
                    </button>
                  )}
                  {item.drive_file_id && <a className="btn btn-sm" href={`https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/view`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Drive</a>}
                  {canDelete && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(item)} disabled={deletingId === item.document_id}>
                      <Trash2 size={14} /> {deletingId === item.document_id ? '삭제 중' : '삭제'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="expense-receipt-pagination" aria-label="페이지 이동">
          <button type="button" className="btn btn-sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>이전</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="btn btn-sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>다음</button>
        </nav>
      )}
    </div>
  );
}
