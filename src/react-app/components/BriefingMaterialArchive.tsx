import { useEffect, useState } from 'react';
import { Archive, Cloud, Download, FileText, Presentation, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';

type Material = {
  id: string; uploader_name: string; branch: string; assignee_name: string; case_number: string;
  material_month: string; file_name: string; file_type: string; file_size: number;
  drive_status: 'pending' | 'success' | 'failed'; drive_folder_path: string;
  drive_backed_up_at?: string; created_at: string;
};
const PAGE_SIZE = 20;
const showSize = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1048576).toFixed(1)}MB`;

export default function BriefingMaterialArchive() {
  const [, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Material[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState('');
  const [branch, setBranch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.briefingMaterials.list({ month, branch, assignee, search: appliedSearch, page, page_size: PAGE_SIZE })
      .then(result => { setItems(result.materials); setTotal(result.total); })
      .catch(error => alert(error instanceof Error ? error.message : '브리핑자료를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [month, branch, assignee, appliedSearch, page]);

  const months = [...new Set(items.map(item => item.material_month))];
  const branches = [...new Set(items.map(item => item.branch).filter(Boolean))];
  const assignees = [...new Set(items.map(item => item.assignee_name).filter(Boolean))];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <div className="page briefing-archive-page">
    <nav className="archive-category-tabs" aria-label="문서보관함 하위 카테고리">
      <button type="button" onClick={() => setSearchParams({})}><FileText size={16} /> 결재문서</button>
      <button type="button" className="active"><Presentation size={16} /> 브리핑자료</button>
    </nav>
    <div className="page-header briefing-archive-header">
      <div><h2><Archive size={24} /> 브리핑자료</h2><p>경매분석에서 제출한 원본과 Google Drive 백업 상태입니다.</p></div>
      <span className="briefing-archive-count">총 {total}건</span>
    </div>
    <form className="briefing-archive-filters" onSubmit={event => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); }}>
      <select value={month} onChange={event => { setMonth(event.target.value); setPage(1); }}><option value="">전체 월</option>{months.map(value => <option key={value}>{value}</option>)}</select>
      <select value={branch} onChange={event => { setBranch(event.target.value); setPage(1); }}><option value="">전체 지사</option>{branches.map(value => <option key={value}>{value}</option>)}</select>
      <select value={assignee} onChange={event => { setAssignee(event.target.value); setPage(1); }}><option value="">전체 담당자</option>{assignees.map(value => <option key={value}>{value}</option>)}</select>
      <label className="briefing-archive-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="파일명, 사건번호, 담당자 검색" /></label>
      <button type="submit" className="btn btn-primary btn-sm">검색</button>
    </form>
    {loading ? <div className="page-loading">로딩 중...</div> : items.length === 0 ? <div className="empty-state">보관 중인 브리핑자료가 없습니다.</div> :
      <div className="briefing-archive-list">{items.map(item => {
        const driveLabel = item.drive_status === 'success' ? 'Drive 백업 완료' : item.drive_status === 'failed' ? '백업 재시도 대기' : '백업 대기';
        return <article key={item.id} className="briefing-archive-item">
          <div className="briefing-archive-file-icon"><Presentation size={22} /></div>
          <div className="briefing-archive-info"><strong>{item.file_name}</strong><div className="briefing-archive-meta">
            <span>{item.material_month}</span><span>{item.branch || '지사 미지정'}</span><span>{item.assignee_name}</span>{item.case_number && <span>사건 {item.case_number}</span>}<span>{showSize(item.file_size)}</span><span>{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
          </div>{item.drive_folder_path && <small className="briefing-drive-path">{item.drive_folder_path}</small>}</div>
          <div className="briefing-archive-actions"><span className={`briefing-drive-status ${item.drive_status}`}><Cloud size={13} /> {driveLabel}</span>
            <button type="button" className="btn btn-sm" onClick={() => api.briefingMaterials.download(item.id, item.file_name)}><Download size={14} /> 원본 받기</button></div>
        </article>;
      })}</div>}
    {totalPages > 1 && <div className="briefing-archive-pagination"><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>이전</button><span>{page} / {totalPages}</span><button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(v => v + 1)}>다음</button></div>}
  </div>;
}
