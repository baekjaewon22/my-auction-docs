import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { Upload, FileText, Trash2, Eye, Download, Plus, X, ArrowLeft } from 'lucide-react';

interface MinuteItem {
  id: string;
  title: string;
  description: string;
  file_name: string;
  file_size: number;
  created_at: string;
  uploader_name: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function MeetingMinutes() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<MinuteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // PDF 뷰어 상태
  const [viewItem, setViewItem] = useState<MinuteItem | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const load = async () => {
    try {
      const res = await api.minutes.list();
      setItems(res.minutes);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // blob URL 해제
  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const handleUpload = async () => {
    if (!title.trim()) { alert('제목을 입력하세요.'); return; }
    if (!file) { alert('PDF 파일을 선택하세요.'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { alert('PDF 파일만 업로드 가능합니다.'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('파일 크기는 5MB 이하만 가능합니다.'); return; }

    setUploading(true);
    try {
      await api.minutes.upload(title.trim(), description.trim(), file);
      setTitle(''); setDescription(''); setFile(null); setShowForm(false);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err: any) {
      alert(err.message || '업로드 실패');
    }
    setUploading(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 회의록을 삭제하시겠습니까?`)) return;
    try {
      await api.minutes.delete(id);
      setItems(items.filter(i => i.id !== id));
      if (viewItem?.id === id) closeViewer();
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  };

  const handleView = async (item: MinuteItem) => {
    setPdfLoading(true);
    setViewItem(item);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);

    try {
      const token = sessionStorage.getItem('token');
      const res = await fetch(`/api/minutes/${item.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('PDF 로드 실패');
      const blob = await res.blob();
      setPdfUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      alert(err.message || 'PDF를 불러올 수 없습니다.');
      setViewItem(null);
    }
    setPdfLoading(false);
  };

  const closeViewer = () => {
    setViewItem(null);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
  };

  const handleDownload = async (item: MinuteItem) => {
    try {
      const token = sessionStorage.getItem('token');
      const res = await fetch(`/api/minutes/${item.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || '다운로드 실패');
    }
  };

  const filtered = items.filter(i =>
    i.title.includes(search) || i.file_name.includes(search) || (i.uploader_name || '').includes(search)
  );

  if (loading) return <div className="page-loading">로딩중...</div>;

  // PDF 뷰어 모드
  if (viewItem) {
    return (
      <div className="page minutes-viewer-page">
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm" onClick={closeViewer}><ArrowLeft size={14} /> 목록</button>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>{viewItem.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: '#888' }}>
              {viewItem.uploader_name} · {formatDate(viewItem.created_at)}
            </span>
            <button className="btn btn-sm" onClick={() => handleDownload(viewItem)}>
              <Download size={13} /> 다운로드
            </button>
          </div>
        </div>
        {viewItem.description && (
          <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: 10 }}>{viewItem.description}</div>
        )}
        <div className="minutes-pdf-container">
          {pdfLoading ? (
            <div className="minutes-pdf-loading">PDF 로딩중...</div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="minutes-pdf-frame"
              title={viewItem.title}
            />
          ) : (
            <div className="minutes-pdf-loading">PDF를 불러올 수 없습니다.</div>
          )}
        </div>
      </div>
    );
  }

  // 목록 모드
  return (
    <div className="page">
      <div className="page-header">
        <h2><FileText size={20} style={{ marginRight: 6, verticalAlign: 'middle' }} />회의록</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? <><X size={14} /> 취소</> : <><Plus size={14} /> 업로드</>}
        </button>
      </div>

      {showForm && (
        <div className="minutes-upload-form">
          <div className="form-group">
            <label>제목 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="회의록 제목" />
          </div>
          <div className="form-group">
            <label>설명</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="간단한 설명 (선택)" />
          </div>
          <div className="form-group">
            <label>PDF 파일 * <span style={{ fontSize: '0.7rem', color: '#888' }}>(최대 5MB)</span></label>
            <input ref={fileRef} type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          {file && (
            <div style={{ fontSize: '0.75rem', color: '#555', marginBottom: 8 }}>
              선택된 파일: <b>{file.name}</b> ({formatSize(file.size)})
            </div>
          )}
          <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
            <Upload size={14} /> {uploading ? '업로드 중...' : '업로드'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <input
          className="search-input"
          placeholder="제목, 파일명, 작성자 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300, padding: '6px 12px', border: '1px solid #dadce0', borderRadius: 6, fontSize: '0.8rem' }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          {items.length === 0 ? '등록된 회의록이 없습니다.' : '검색 결과가 없습니다.'}
        </div>
      ) : (
        <div className="minutes-list">
          {filtered.map((item) => (
            <div key={item.id} className="minutes-card">
              <div className="minutes-card-icon">
                <FileText size={28} />
              </div>
              <div className="minutes-card-body">
                <div className="minutes-card-title">{item.title}</div>
                {item.description && <div className="minutes-card-desc">{item.description}</div>}
                <div className="minutes-card-meta">
                  <span>{item.file_name}</span>
                  <span>{formatSize(item.file_size)}</span>
                  <span>{item.uploader_name}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
              </div>
              <div className="minutes-card-actions">
                <button className="btn btn-sm" onClick={() => handleView(item)} title="보기">
                  <Eye size={14} /> 보기
                </button>
                <button className="btn btn-sm" onClick={() => handleDownload(item)} title="다운로드">
                  <Download size={14} />
                </button>
                {user && ['master', 'ceo', 'cc_ref'].includes(user.role) && (
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item.id, item.title)} title="삭제">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
