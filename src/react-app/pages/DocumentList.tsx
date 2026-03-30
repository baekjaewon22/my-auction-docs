import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Document } from '../types';
import { FileText, FilePlus, FileCheck, FileX, Plus, X } from 'lucide-react';

const statusConfig: Record<string, { label: string; className: string; icon: typeof FileText }> = {
  draft: { label: '작성중', className: 'status-draft', icon: FilePlus },
  submitted: { label: '제출', className: 'status-submitted', icon: FileText },
  approved: { label: '승인', className: 'status-approved', icon: FileCheck },
  rejected: { label: '반려', className: 'status-rejected', icon: FileX },
};

export default function DocumentList() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.documents.list(filter || undefined)
      .then((res) => setDocuments(res.documents))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const handleNew = async () => {
    const { document } = await api.documents.create({ title: '새 문서' });
    navigate('/documents/' + document.id);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('문서를 삭제하시겠습니까?')) return;
    await api.documents.delete(id);
    load();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>내 문서</h2>
        <button className="btn btn-primary" onClick={handleNew}><Plus size={16} /> 새 문서</button>
      </div>

      <div className="filter-bar">
        <button className={`filter-btn ${filter === '' ? 'active' : ''}`} onClick={() => setFilter('')}>전체</button>
        <button className={`filter-btn ${filter === 'draft' ? 'active' : ''}`} onClick={() => setFilter('draft')}>작성중</button>
        <button className={`filter-btn ${filter === 'submitted' ? 'active' : ''}`} onClick={() => setFilter('submitted')}>제출</button>
        <button className={`filter-btn ${filter === 'approved' ? 'active' : ''}`} onClick={() => setFilter('approved')}>승인</button>
        <button className={`filter-btn ${filter === 'rejected' ? 'active' : ''}`} onClick={() => setFilter('rejected')}>반려</button>
      </div>

      {loading ? (
        <div className="page-loading">로딩중...</div>
      ) : (
        <div className="doc-card-grid">
          {documents.map((doc) => {
            const cfg = statusConfig[doc.status];
            const Icon = cfg?.icon || FileText;
            return (
              <Link to={'/documents/' + doc.id} key={doc.id} className="doc-card">
                <div className="doc-card-header">
                  <span className={`status-badge ${cfg?.className}`}>{cfg?.label}</span>
                  {doc.status === 'draft' && (
                    <button className="doc-card-delete" onClick={(e) => handleDelete(doc.id, e)} title="삭제">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="doc-card-body">
                  <Icon size={32} className="doc-card-lucide-icon" />
                  <div className="doc-card-title">{doc.title}</div>
                </div>
                <div className="doc-card-footer">
                  {doc.author_name && <span>{doc.author_name}</span>}
                  <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                </div>
              </Link>
            );
          })}
          {documents.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1 / -1' }}>문서가 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}
