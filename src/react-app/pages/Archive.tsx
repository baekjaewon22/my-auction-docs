import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import { BRANCHES } from '../types';
import type { Document } from '../types';
import Select, { toOptions } from '../components/Select';
import { useDepartments } from '../hooks/useDepartments';
import { Archive, FileCheck, FileText, Search, Trash2 } from 'lucide-react';

const BRANCH_OPTS = toOptions(BRANCHES);

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: '작성중', className: 'status-draft' },
  submitted: { label: '제출', className: 'status-submitted' },
  approved: { label: '승인', className: 'status-approved' },
  rejected: { label: '반려', className: 'status-rejected' },
};

export default function ArchivePage() {
  const { user } = useAuthStore();
  const { departments } = useDepartments();
  const DEPT_OPTS = toOptions(departments);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterStatus, setFilterStatus] = useState('approved');
  const [searchText, setSearchText] = useState('');

  const isCeoPlus = user?.role === 'master' || user?.role === 'ceo' || user?.role === 'cc_ref' || user?.role === 'admin';
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || '');

  useEffect(() => {
    setLoading(true);
    api.documents.list('approved')
      .then((res) => setDocuments(res.documents))
      .finally(() => setLoading(false));
  }, []);

  // 필터 적용
  let filtered = documents;
  if (filterStatus) filtered = filtered.filter((d) => d.status === filterStatus);
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

  // 월별 그룹핑
  const grouped = filtered.reduce<Record<string, Document[]>>((acc, d) => {
    const m = d.created_at.slice(0, 7);
    if (!acc[m]) acc[m] = [];
    acc[m].push(d);
    return acc;
  }, {});

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
        <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>총 {filtered.length}건</span>
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

      {/* 문서 목록 - 월별 그룹 */}
      {Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map((month) => (
        <section key={month} className="archive-month-section">
          <div className="archive-month-header">
            <span className="archive-month-label">{month}</span>
            <span className="archive-month-count">{grouped[month].length}건</span>
          </div>
          <div className="archive-doc-list">
            {grouped[month].map((doc) => (
              <Link to={'/documents/' + doc.id} key={doc.id} className="archive-doc-item">
                <div className="archive-doc-icon">
                  {doc.status === 'approved' ? <FileCheck size={18} color="#188038" /> : <FileText size={18} color="#9aa0a6" />}
                </div>
                <div className="archive-doc-info">
                  <div className="archive-doc-title">{doc.title}</div>
                  <div className="archive-doc-meta">
                    {doc.author_name && <span>{doc.author_name}</span>}
                    {doc.branch && <span>{doc.branch}</span>}
                    {doc.department && <span>{doc.department}</span>}
                    <span>{new Date(doc.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`status-badge ${statusConfig[doc.status]?.className}`}>
                    {statusConfig[doc.status]?.label}
                  </span>
                  {isCeoPlus && (doc.status !== 'approved' || user?.role === 'master') && (
                    <button className="btn btn-sm btn-danger" style={{ padding: '2px 6px' }} onClick={(e) => handleDelete(doc.id, e)} title="삭제">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <div className="empty-state">조건에 맞는 문서가 없습니다.</div>
      )}
    </div>
  );
}
