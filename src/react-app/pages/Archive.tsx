import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { Document } from '../types';
import Select, { toOptions } from '../components/Select';
import { useDepartments } from '../hooks/useDepartments';
import { useBranches } from '../hooks/useBranches';
import { Archive, FileCheck, FileText, Search, Trash2, MapPin } from 'lucide-react';

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: '작성중', className: 'status-draft' },
  submitted: { label: '제출', className: 'status-submitted' },
  approved: { label: '승인', className: 'status-approved' },
  rejected: { label: '반려', className: 'status-rejected' },
};

export default function ArchivePage() {
  const { user } = useAuthStore();
  const { departments } = useDepartments();
  const { branches } = useBranches();
  const DEPT_OPTS = toOptions(departments);
  const BRANCH_OPTS = branches.map(b => ({ value: b, label: b }));
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterStatus, setFilterStatus] = useState('approved');
  const [searchText, setSearchText] = useState('');

  // 외근 보고서에서 외근 일자 추출
  const extractOutingDate = (content: string): string | null => {
    if (!content) return null;
    // "외근 일자 : 2026년 4월 3일" 또는 "외근 일자 : 2026 년 4 월 3일" 등 다양한 형태
    const text = content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const m = text.match(/외근\s*일자\s*[:\s]*(\d{2,4})\s*년?\s*(\d{1,2})\s*월?\s*(\d{1,2})\s*일/);
    if (m) {
      const year = m[1].length === 2 ? '20' + m[1] : m[1];
      return `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    return null;
  };

  const isCeoPlus = user?.role === 'master' || user?.role === 'ceo' || user?.role === 'cc_ref' || user?.role === 'admin';
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || '');

  // 다운로드 체크 (localStorage)
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('archive_checked') || '{}'); } catch { return {}; }
  });
  const toggleCheck = (id: string) => {
    setChecked(prev => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('archive_checked', JSON.stringify(next));
      return next;
    });
  };

  const [statusTab, setStatusTab] = useState<'all' | 'approved' | 'cancelled'>('approved');

  useEffect(() => {
    setLoading(true);
    api.documents.list('approved')
      .then((res) => {
        setDocuments(res.documents);
      })
      .finally(() => setLoading(false));
  }, []);

  // 상태 탭 필터
  let filtered = documents;
  if (statusTab === 'approved') filtered = filtered.filter(d => d.status === 'approved' && d.cancelled !== 1);
  else if (statusTab === 'cancelled') filtered = filtered.filter(d => d.cancelled === 1);
  // 'all'은 전체
  if (filterStatus && statusTab === 'all') filtered = filtered.filter((d) => d.status === filterStatus);
  if (filterMonth) filtered = filtered.filter((d) => d.created_at.startsWith(filterMonth));
  if (filterBranch) filtered = filtered.filter((d) => d.branch === filterBranch);
  if (filterDept) filtered = filtered.filter((d) => d.department === filterDept);
  if (filterAuthor) filtered = filtered.filter((d) => d.author_name?.includes(filterAuthor));
  if (searchText) filtered = filtered.filter((d) => d.title.includes(searchText) || d.author_name?.includes(searchText));

  // 월 목록
  const months = [...new Set(documents.map((d) => d.created_at.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
  const monthOpts = months.map((m) => ({ value: m, label: m }));

  // 작성자 목록
  const authors = [...new Set(documents.map((d) => d.author_name).filter(Boolean))].sort();
  const authorOpts = authors.map((a) => ({ value: a!, label: a! }));

  // 페이지네이션
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 필터 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1); }, [statusTab, filterMonth, filterBranch, filterDept, filterAuthor, searchText]);

  const resetFilters = () => {
    setFilterMonth('');
    setFilterBranch('');
    setFilterDept('');
    setFilterAuthor('');
    setSearchText('');
    setFilterStatus('approved');
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('문서를 삭제하시겠습니까?')) return;
    try {
      await api.documents.delete(id);
      setDocuments(documents.filter(d => d.id !== id));
    } catch (err: any) { alert(err.message); }
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><Archive size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 문서 보관함</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(['all', 'approved', 'cancelled'] as const).map(tab => {
            const labels = { all: '전체', approved: '승인', cancelled: '취소' };
            const count = tab === 'all' ? documents.length : tab === 'approved' ? documents.filter(d => d.status === 'approved' && d.cancelled !== 1).length : documents.filter(d => d.cancelled === 1).length;
            return (
              <button key={tab} className={`btn btn-sm ${statusTab === tab ? 'btn-primary' : ''}`}
                style={statusTab !== tab ? { border: '1px solid #dadce0', background: '#fff' } : {}}
                onClick={() => setStatusTab(tab)}>
                {labels[tab]} <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 필터 */}
      <div className="archive-filters">
        <div className="archive-filter-row">
          <div className="archive-filter-item">
            <Select size="sm" options={monthOpts} value={filterMonth ? { value: filterMonth, label: filterMonth } : null} onChange={(o: any) => setFilterMonth(o?.value || '')} placeholder="전체 기간" isClearable />
          </div>
          {(isCeoPlus || isAdmin) && (
            <div className="archive-filter-item">
              <Select size="sm" options={BRANCH_OPTS} value={filterBranch ? { value: filterBranch, label: filterBranch } : null} onChange={(o: any) => { setFilterBranch(o?.value || ''); setFilterDept(''); }} placeholder="전체 지사" isClearable />
            </div>
          )}
          <div className="archive-filter-item">
            <Select size="sm" options={DEPT_OPTS} value={filterDept ? { value: filterDept, label: filterDept } : null} onChange={(o: any) => setFilterDept(o?.value || '')} placeholder="전체 팀" isClearable />
          </div>
          <div className="archive-filter-item">
            <Select size="sm" options={authorOpts} value={filterAuthor ? { value: filterAuthor, label: filterAuthor } : null} onChange={(o: any) => setFilterAuthor(o?.value || '')} placeholder="작성자" isClearable isSearchable />
          </div>
          <div className="archive-filter-item archive-search">
            <Search size={14} className="archive-search-icon" />
            <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="제목/작성자 검색" className="archive-search-input" />
          </div>
        </div>
        {(filterMonth || filterBranch || filterDept || filterAuthor || searchText) && (
          <div className="archive-filter-tags">
            {filterMonth && <span className="stats-filter-tag">{filterMonth}</span>}
            {filterBranch && <span className="stats-filter-tag">{filterBranch}</span>}
            {filterDept && <span className="stats-filter-tag">{filterDept}</span>}
            {filterAuthor && <span className="stats-filter-tag">{filterAuthor}</span>}
            {searchText && <span className="stats-filter-tag">"{searchText}"</span>}
            <button className="btn-link" style={{ fontSize: '0.75rem', marginLeft: 4 }} onClick={resetFilters}>초기화</button>
          </div>
        )}
      </div>

      {/* 페이지 정보 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: '0.8rem', color: '#9aa0a6' }}>
        <span>총 {filtered.length}건 중 {(page - 1) * PAGE_SIZE + 1}~{Math.min(page * PAGE_SIZE, filtered.length)}건</span>
        <span>{page} / {totalPages} 페이지</span>
      </div>

      {/* 문서 목록 - 월별 그룹 + 페이지네이션 */}
      {(() => {
        const pagedGrouped = paged.reduce<Record<string, Document[]>>((acc, d) => {
          const m = d.created_at.slice(0, 7);
          if (!acc[m]) acc[m] = [];
          acc[m].push(d);
          return acc;
        }, {});
        return Object.keys(pagedGrouped).sort((a, b) => b.localeCompare(a)).map(month => (
          <section key={month} className="archive-month-section">
            <div className="archive-month-header">
              <span className="archive-month-label">{month}</span>
              <span className="archive-month-count">{pagedGrouped[month].length}건</span>
            </div>
            <div className="archive-doc-list">
        {pagedGrouped[month].map((doc) => {
          const isCancelled = doc.cancelled === 1;
          return (
            <Link to={'/documents/' + doc.id} key={doc.id} className={`archive-doc-item ${isCancelled ? 'archive-doc-cancelled' : ''}`}>
              <input
                type="checkbox"
                checked={!!checked[doc.id]}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleCheck(doc.id); }}
                readOnly
                className="archive-doc-check"
                title="다운로드 체크"
              />
              <div className="archive-doc-icon">
                {isCancelled ? <FileText size={18} color="#bdc1c6" /> : doc.status === 'approved' ? <FileCheck size={18} color="#188038" /> : <FileText size={18} color="#9aa0a6" />}
              </div>
              <div className="archive-doc-info">
                <div className="archive-doc-title">{doc.title}</div>
                <div className="archive-doc-meta">
                  {doc.author_name && <span>{doc.author_name}</span>}
                  {doc.branch && <span>{doc.branch}</span>}
                  {doc.department && <span>{doc.department}</span>}
                  <span>{new Date(doc.created_at).toLocaleDateString('ko-KR')}</span>
                  {doc.title.includes('외근') && (() => {
                    const outDate = extractOutingDate(doc.content);
                    return outDate ? <span style={{ color: '#1a73e8', fontWeight: 600 }}><MapPin size={10} style={{ verticalAlign: 'middle' }} /> 외근일 {outDate}</span> : null;
                  })()}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isCancelled ? (
                  <span className="status-badge status-cancelled">취소</span>
                ) : (
                  <span className={`status-badge ${statusConfig[doc.status]?.className}`}>
                    {statusConfig[doc.status]?.label}
                  </span>
                )}
                {isCeoPlus && (doc.status !== 'approved' || user?.role === 'master') && (
                  <button className="btn btn-sm btn-danger" style={{ padding: '2px 6px' }} onClick={(e) => handleDelete(doc.id, e)} title="삭제">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </Link>
          );
        })}
            </div>
          </section>
        ));
      })()}

      {filtered.length === 0 && (
        <div className="empty-state">조건에 맞는 문서가 없습니다.</div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 20, paddingBottom: 20 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(1)} style={{ opacity: page <= 1 ? 0.4 : 1 }}>«</button>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ opacity: page <= 1 ? 0.4 : 1 }}>‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .reduce<(number | string)[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) => typeof p === 'string' ? (
              <span key={`dot-${i}`} style={{ padding: '0 4px', color: '#9aa0a6' }}>···</span>
            ) : (
              <button key={p} className={`btn btn-sm ${p === page ? 'btn-primary' : ''}`}
                style={p !== page ? { border: '1px solid #dadce0', background: '#fff', minWidth: 32 } : { minWidth: 32 }}
                onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ opacity: page >= totalPages ? 0.4 : 1 }}>›</button>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} style={{ opacity: page >= totalPages ? 0.4 : 1 }}>»</button>
        </div>
      )}
    </div>
  );
}
