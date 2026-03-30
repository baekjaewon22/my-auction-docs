import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Document } from '../types';
import { FileText, FilePlus, FileCheck, FileX, Files } from 'lucide-react';

const statusConfig: Record<string, { label: string; className: string; icon: typeof FileText }> = {
  draft: { label: '작성중', className: 'status-draft', icon: FilePlus },
  submitted: { label: '제출', className: 'status-submitted', icon: FileText },
  approved: { label: '승인', className: 'status-approved', icon: FileCheck },
  rejected: { label: '반려', className: 'status-rejected', icon: FileX },
};

export default function Dashboard() {
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.documents.list()
      .then((res) => setDocuments(res.documents))
      .finally(() => setLoading(false));
  }, []);

  const stats = {
    total: documents.length,
    draft: documents.filter((d) => d.status === 'draft').length,
    submitted: documents.filter((d) => d.status === 'submitted').length,
    approved: documents.filter((d) => d.status === 'approved').length,
    rejected: documents.filter((d) => d.status === 'rejected').length,
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page dashboard-page">
      <div className="page-header">
        <h2>대시보드</h2>
        <p className="greeting">안녕하세요, <strong>{user?.name}</strong>님!</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><Files size={28} className="stat-icon" /><div className="stat-number">{stats.total}</div><div className="stat-label">전체 문서</div></div>
        <div className="stat-card stat-draft"><FilePlus size={28} className="stat-icon" /><div className="stat-number">{stats.draft}</div><div className="stat-label">작성중</div></div>
        <div className="stat-card stat-submitted"><FileText size={28} className="stat-icon" /><div className="stat-number">{stats.submitted}</div><div className="stat-label">제출</div></div>
        <div className="stat-card stat-approved"><FileCheck size={28} className="stat-icon" /><div className="stat-number">{stats.approved}</div><div className="stat-label">승인</div></div>
        <div className="stat-card stat-rejected"><FileX size={28} className="stat-icon" /><div className="stat-number">{stats.rejected}</div><div className="stat-label">반려</div></div>
      </div>

      <section className="section">
        <div className="section-header">
          <h3 className="section-title">최근 문서</h3>
          <Link to="/documents" className="btn btn-sm">전체 보기</Link>
        </div>
        <div className="doc-list">
          {documents.slice(0, 5).map((doc) => {
            const cfg = statusConfig[doc.status];
            const Icon = cfg?.icon || FileText;
            return (
              <Link to={'/documents/' + doc.id} key={doc.id} className="doc-item">
                <div className="doc-info">
                  <Icon size={16} style={{ color: 'var(--gray-400)', marginRight: 8, flexShrink: 0 }} />
                  <div>
                    <div className="doc-title">{doc.title}</div>
                    <div className="doc-meta">
                      {doc.author_name && <span>{doc.author_name}</span>}
                      <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                    </div>
                  </div>
                </div>
                <span className={`status-badge ${cfg?.className}`}>{cfg?.label}</span>
              </Link>
            );
          })}
          {documents.length === 0 && <div className="empty-state">아직 문서가 없습니다.</div>}
        </div>
      </section>
    </div>
  );
}
