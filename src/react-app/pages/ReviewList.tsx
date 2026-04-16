import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { Document } from '../types';
import { FileText, Trash2 } from 'lucide-react';

export default function ReviewList() {
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const isCeoPlus = !!user && ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role);

  const load = () => {
    setLoading(true);
    api.documents.list('submitted')
      .then((res) => setDocuments(res.documents))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
        <h2>문서 승인</h2>
        <p className="page-desc">제출된 문서를 검토하고 승인 또는 반려하세요.</p>
      </div>

      <div className="doc-list">
        {documents.map((doc) => (
          <Link to={'/documents/' + doc.id} key={doc.id} className="doc-item"
            style={doc.cancel_requested ? { background: '#fef2f2', borderColor: '#fecaca' } : undefined}>
            <div className="doc-info">
              <FileText size={16} style={{ color: doc.cancel_requested ? '#dc2626' : 'var(--primary)', marginRight: 8, flexShrink: 0 }} />
              <div>
                <div className="doc-title" style={doc.cancel_requested ? { color: '#dc2626' } : undefined}>
                  {doc.cancel_requested ? '[취소신청] ' : ''}{doc.title}
                </div>
                <div className="doc-meta">
                  <span>작성자: {doc.author_name}</span>
                  {doc.branch && <span>{doc.branch}</span>}
                  {doc.department && <span>{doc.department}</span>}
                  <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                </div>
                {doc.cancel_requested === 1 && doc.cancel_reason && (
                  <div style={{ fontSize: '0.78rem', color: '#dc2626', marginTop: 4, padding: '4px 8px', background: '#fff5f5', borderRadius: 4, border: '1px dashed #fca5a5' }}>
                    취소 사유: {doc.cancel_reason}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {doc.cancel_requested ? (
                <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>취소신청</span>
              ) : (
                <span className="status-badge status-submitted">제출</span>
              )}
              {isCeoPlus && (
                <button className="btn btn-sm btn-danger" style={{ padding: '2px 6px' }} onClick={(e) => handleDelete(doc.id, e)} title="삭제">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </Link>
        ))}
        {documents.length === 0 && (
          <div className="empty-state">승인 대기 중인 문서가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
