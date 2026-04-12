import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { Upload, FileText, Trash2, Eye, Download, Plus, X, ArrowLeft, Share2, FileUp } from 'lucide-react';
import Select from '../components/Select';

interface MinuteItem {
  id: string;
  title: string;
  description: string;
  file_name: string;
  file_size: number;
  created_at: string;
  uploader_name: string;
  source_type?: string;
  converted_content?: string;
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
  // txt 변환 폼
  const [showTxtForm, setShowTxtForm] = useState(false);
  const [txtTitle, setTxtTitle] = useState('');
  const [txtContent, setTxtContent] = useState('');
  const [txtConverting, setTxtConverting] = useState(false);
  // 공유
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareTargets, setShareTargets] = useState<string[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string; role: string; department: string }[]>([]);
  // 공유자 정보
  const [sharesMap, setSharesMap] = useState<Record<string, { user_name: string; read_at: string | null }[]>>({});
  // 상세 보기 (변환된 회의록)
  const [detailContent, setDetailContent] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState('');

  // PDF 뷰어 상태
  const [viewItem, setViewItem] = useState<MinuteItem | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const load = async () => {
    try {
      const res = await api.minutes.list();
      setItems(res.minutes);
      // 각 회의록의 공유자 로드
      const map: Record<string, any[]> = {};
      for (const m of res.minutes) {
        try {
          const detail = await api.minutes.get(m.id);
          if (detail.shares?.length > 0) map[m.id] = detail.shares;
        } catch { /* */ }
      }
      setSharesMap(map);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { load(); api.journal.members().then(r => setMembers(r.members)).catch(() => {}); }, []);

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

  // txt → 회의록 변환
  const handleTxtConvert = async () => {
    if (!txtTitle.trim()) { alert('제목을 입력하세요.'); return; }
    if (!txtContent.trim()) { alert('내용을 입력하세요.'); return; }
    setTxtConverting(true);
    try {
      const res = await api.minutes.convertTxt({ title: txtTitle.trim(), raw_text: txtContent.trim(), share_with: shareTargets.length > 0 ? shareTargets : undefined });
      setDetailContent(res.converted);
      setDetailTitle(txtTitle.trim());
      setTxtTitle(''); setTxtContent(''); setShareTargets([]); setShowTxtForm(false);
      await load();
    } catch (err: any) { alert(err.message); }
    setTxtConverting(false);
  };

  // txt 파일 읽기
  const handleTxtFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setTxtContent(reader.result as string); if (!txtTitle) setTxtTitle(f.name.replace(/\.txt$/i, '')); };
    reader.readAsText(f);
    e.target.value = '';
  };

  // 공유
  const handleShare = async (minutesId: string) => {
    if (shareTargets.length === 0) { alert('공유 대상을 선택하세요.'); return; }
    try { await api.minutes.share(minutesId, shareTargets); setSharingId(null); setShareTargets([]); alert('공유되었습니다.'); load(); }
    catch (err: any) { alert(err.message); }
  };

  // 상세 보기
  const handleViewDetail = async (item: MinuteItem) => {
    try {
      const res = await api.minutes.get(item.id);
      setDetailContent(res.minute.converted_content || '');
      setDetailTitle(item.title);
    } catch { setDetailContent(null); }
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
      const token = localStorage.getItem('token');
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
      const token = localStorage.getItem('token');
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowTxtForm(!showTxtForm); setShowForm(false); }}>
            {showTxtForm ? <><X size={14} /> 취소</> : <><FileUp size={14} /> TXT 변환</>}
          </button>
          <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); setShowTxtForm(false); }}>
            {showForm ? <><X size={14} /> 취소</> : <><Plus size={14} /> PDF 업로드</>}
          </button>
        </div>
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

      {/* txt 변환 폼 */}
      {showTxtForm && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>TXT → 회의록 변환</h3>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>제목 *</label>
            <input className="form-input" value={txtTitle} onChange={(e) => setTxtTitle(e.target.value)} placeholder="회의록 제목" style={{ width: '100%' }} />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>.txt 파일 또는 직접 입력</label>
            <input type="file" accept=".txt" onChange={handleTxtFile} style={{ marginBottom: 8 }} />
            <textarea className="form-input" value={txtContent} onChange={(e) => setTxtContent(e.target.value)}
              placeholder="회의 내용을 입력하거나 txt 파일을 선택하세요..." rows={8} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>공유 대상 <span style={{ fontSize: '0.72rem', color: '#9aa0a6' }}>선택사항</span></label>
            <Select isMulti options={members.map(m => ({ value: m.id, label: `${m.name} (${m.department || ''})` }))}
              value={members.filter(m => shareTargets.includes(m.id)).map(m => ({ value: m.id, label: `${m.name} (${m.department || ''})` }))}
              onChange={(opts: any) => setShareTargets((opts || []).map((o: any) => o.value))}
              placeholder="공유할 인원 선택..." />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleTxtConvert} disabled={txtConverting}>
              {txtConverting ? '변환 중...' : '변환 및 저장'}
            </button>
            <button className="btn" onClick={() => setShowTxtForm(false)}>취소</button>
          </div>
        </div>
      )}

      {/* 변환된 회의록 상세 보기 */}
      {detailContent && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{detailTitle}</h3>
            <button className="btn btn-sm" onClick={() => setDetailContent(null)}><X size={14} /> 닫기</button>
          </div>
          <div dangerouslySetInnerHTML={{ __html: detailContent }} style={{ fontSize: '0.85rem', lineHeight: 1.7 }} />
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
                {sharesMap[item.id]?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    <span style={{ fontSize: '0.68rem', color: '#9aa0a6' }}>공유:</span>
                    {sharesMap[item.id].map((s: any, i: number) => (
                      <span key={i} style={{
                        padding: '1px 6px', borderRadius: 10, fontSize: '0.68rem', fontWeight: 500,
                        background: s.read_at ? '#e8f5e9' : '#fff3e0',
                        color: s.read_at ? '#188038' : '#e65100',
                      }}>
                        {s.user_name}{s.read_at ? ' ✓' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="minutes-card-actions">
                {item.source_type === 'txt' ? (
                  <button className="btn btn-sm" onClick={() => handleViewDetail(item)} title="보기">
                    <Eye size={14} /> 보기
                  </button>
                ) : (
                  <button className="btn btn-sm" onClick={() => handleView(item)} title="보기">
                    <Eye size={14} /> 보기
                  </button>
                )}
                {item.source_type !== 'txt' && (
                  <button className="btn btn-sm" onClick={() => handleDownload(item)} title="다운로드">
                    <Download size={14} />
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => { setSharingId(item.id); setShareTargets([]); }} title="공유">
                  <Share2 size={14} />
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
      {/* 공유 모달 */}
      {sharingId && (
        <div className="modal-overlay" onClick={() => setSharingId(null)}>
          <div className="journal-form-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="journal-form-header">
              <h3>회의록 공유</h3>
              <button className="btn-close" onClick={() => setSharingId(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">공유 대상 선택</label>
                <Select isMulti
                  options={members.map(m => ({ value: m.id, label: `${m.name} (${m.department || ''})` }))}
                  value={members.filter(m => shareTargets.includes(m.id)).map(m => ({ value: m.id, label: `${m.name} (${m.department || ''})` }))}
                  onChange={(opts: any) => setShareTargets((opts || []).map((o: any) => o.value))}
                  placeholder="인원 검색..." isSearchable />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleShare(sharingId)}>
                  <Share2 size={14} /> 공유하기 ({shareTargets.length}명)
                </button>
                <button className="btn" onClick={() => setSharingId(null)}>취소</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
