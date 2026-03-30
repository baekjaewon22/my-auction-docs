import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Document } from '../types';
import { FileText } from 'lucide-react';

export default function ReviewList() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.documents.list('submitted')
      .then((res) => setDocuments(res.documents))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>문서 승인</h2>
        <p className="page-desc">제출된 문서를 검토하고 승인 또는 반려하세요.</p>
      </div>

      <div className="doc-list">
        {documents.map((doc) => (
          <Link to={'/documents/' + doc.id} key={doc.id} className="doc-item">
            <div className="doc-info">
              <FileText size={16} style={{ color: 'var(--primary)', marginRight: 8, flexShrink: 0 }} />
              <div>
                <div className="doc-title">{doc.title}</div>
                <div className="doc-meta">
                  <span>작성자: {doc.author_name}</span>
                  {doc.branch && <span>{doc.branch}</span>}
                  {doc.department && <span>{doc.department}</span>}
                  <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
            </div>
            <span className="status-badge status-submitted">제출</span>
          </Link>
        ))}
        {documents.length === 0 && (
          <div className="empty-state">승인 대기 중인 문서가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
