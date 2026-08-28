import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Image,
  Plus,
  Receipt,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api, type ExpenseReceiptArchiveItem } from '../api';
import { useAuthStore } from '../store';
import { useBranches } from '../hooks/useBranches';
import { formatExpenseReceiptBytes, formatExpenseReceiptDateTime } from '../lib/expense-receipt';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '작성중', className: 'status-draft' },
  submitted: { label: '제출', className: 'status-submitted' },
  approved: { label: '승인', className: 'status-approved' },
  rejected: { label: '반려', className: 'status-rejected' },
  cancel_requested: { label: '취소 신청', className: 'status-cancel-req' },
  cancelled: { label: '취소', className: 'status-cancelled' },
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '영수증 지출결의서 보관함을 불러오지 못했습니다.';
}

export default function ExpenseReceiptArchive() {
  const { user } = useAuthStore();
  const { branches } = useBranches();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpenseReceiptArchiveItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState('approved');
  const [month, setMonth] = useState('');
  const [branch, setBranch] = useState('');
  const [author, setAuthor] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState('');
  const [error, setError] = useState('');

  const isFreelancer = user?.login_type === 'freelancer' && user.role !== 'master';
  const canViewAll = Boolean(user && !isFreelancer
    && ['master', 'ceo', 'accountant', 'accountant_asst'].includes(user.role));
  const scopeDescription = canViewAll
    ? '전 직원의 승인 완료·취소된 지출결의 최종본을 확인합니다. (작성중·제출·반려 건은 대시보드/내 문서에서 처리)'
    : '내가 승인 완료한 지출결의 최종본을 확인합니다. (작성중·반려 건은 대시보드/내 문서에서 처리)';
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
        branch: canViewAll ? branch : '',
        author: canViewAll ? author : '',
        search: search.trim(),
      });
      setItems(response.items || []);
      setTotal(response.total || 0);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, month, branch, author, search, canViewAll]);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const summary = useMemo(() => items.reduce((acc, item) => {
    acc.attachments += Number(item.attachment_count || 0);
    acc.bytes += Number(item.total_file_size || 0);
    if (item.cancelled) acc.cancelled += 1;
    else if (item.cancel_requested) acc.cancelRequested += 1;
    else if (item.status === 'approved') acc.approved += 1;
    return acc;
  }, { attachments: 0, bytes: 0, approved: 0, cancelled: 0, cancelRequested: 0 }), [items]);

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

  return (
    <div className="page expense-receipt-archive-page">
      <nav className="archive-category-tabs" aria-label="문서보관함 하위 카테고리">
        {!isFreelancer && <button type="button" onClick={() => navigate('/archive')}><FileText size={16} /> 결재문서</button>}
        {!isFreelancer && <button type="button" onClick={() => navigate('/archive?category=briefing')}><FileCheck size={16} /> 브리핑자료</button>}
        <button type="button" className="active"><Receipt size={16} /> 영수증 지출결의</button>
      </nav>

      <header className="expense-receipt-archive-header">
        <div>
          <h2><Archive size={24} /> 영수증 지출결의 보관함</h2>
          <p>{scopeDescription}</p>
        </div>
        <div>
          <button type="button" className="btn" onClick={load} disabled={loading}><RefreshCw size={15} /> 새로고침</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/expense-receipts/new')}><Plus size={15} /> 새 지출결의</button>
        </div>
      </header>

      {error && <div className="alert alert-error"><AlertTriangle size={17} /> {error}</div>}

      <section className="expense-receipt-archive-summary">
        <div><span>검색 결과</span><strong>{total}건</strong></div>
        <div><span>현재 페이지 영수증</span><strong>{summary.attachments}장</strong><small>{formatExpenseReceiptBytes(summary.bytes)}</small></div>
        <div><span>승인 완료</span><strong>{summary.approved}건</strong></div>
        <div><span>취소 처리</span><strong>{summary.cancelled}건</strong><small>취소 신청 {summary.cancelRequested}건</small></div>
      </section>

      <section className="expense-receipt-archive-filters" aria-label="보관함 필터">
        <label><span>상태</span><select className="form-input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="approved">승인 완료</option><option value="cancelled">취소</option></select></label>
        <label><span>월</span><input type="month" className="form-input" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }} /></label>
        {canViewAll && <label><span>지사</span><select className="form-input" value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }}><option value="">전체 지사</option>{branches.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
        {canViewAll && <label><span>작성자</span><input className="form-input" value={author} onChange={(event) => { setAuthor(event.target.value); setPage(1); }} placeholder="작성자명" /></label>}
        <label className="expense-receipt-archive-search"><span>검색</span><div><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="제목·작성자 검색" /></div></label>
      </section>

      {loading ? (
        <div className="page-loading">보관 내역을 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">조건에 맞는 영수증 지출결의서가 없습니다.</div>
      ) : (
        <div className="expense-receipt-archive-list">
          {items.map((item) => {
            const effectiveStatus = item.cancelled ? 'cancelled' : item.cancel_requested ? 'cancel_requested' : item.status;
            const statusInfo = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.draft;
            const pdfReady = Boolean(item.pdf_available);
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
                  <span><Image size={14} /> 영수증 {item.attachment_count}장 · {formatExpenseReceiptBytes(item.total_file_size)}</span>
                  <span className={item.drive_status === 'failed' ? 'failed' : item.drive_status === 'success' ? 'success' : ''}>
                    <Cloud size={14} /> {item.drive_status === 'success' ? 'Drive 백업 완료' : item.drive_status === 'failed' ? 'Drive 백업 실패' : 'Drive 백업 대기'}
                  </span>
                  <span className={item.site_purged ? 'success' : ''}><CheckCircle2 size={14} /> {item.site_purged ? '사이트 원본 30일 정리 완료' : item.cancelled ? '취소 처리' : item.cancel_requested ? '취소 승인 대기' : item.status === 'approved' ? '30일 보관 중' : '승인 대기'}</span>
                  {item.cancel_reason && (item.cancelled || item.cancel_requested) && <small>취소 사유: {item.cancel_reason}</small>}
                  {item.actual_approver_name && <small>{item.cancelled ? '승인 이력' : '실제 승인자'}: {item.actual_approver_name} ({item.actual_approver_role})</small>}
                </div>
                <div className="expense-receipt-archive-actions">
                  <Link className="btn btn-sm" to={`/expense-receipts/${item.document_id}`}>상세</Link>
                  {pdfReady && <button type="button" className="btn btn-sm" onClick={() => downloadPdf(item)} disabled={downloadingId === item.document_id}><Download size={14} /> {downloadingId === item.document_id ? '받는 중' : '합본 PDF'}</button>}
                  {item.drive_file_id && <a className="btn btn-sm" href={`https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/view`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Drive에서 열기</a>}
                  {item.site_purged && <span className="expense-receipt-drive-only">Drive 보관</span>}
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
