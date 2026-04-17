import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { useBranches } from '../hooks/useBranches';
import Select from '../components/Select';
import { Handshake, Send, Check, Camera, Download, X, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const COURTS = ['의정부지방법원', '서울중앙지방법원', '서울남부지방법원', '서울동부지방법원', '서울서부지방법원', '서울북부지방법원', '인천지방법원', '수원지방법원', '대전지방법원', '대구지방법원', '부산지방법원', '울산지방법원', '창원지방법원', '광주지방법원', '전주지방법원', '청주지방법원', '춘천지방법원', '제주지방법원'];
const DEFAULT_CONTENT = `임장 사진 촬영 요청 / 임장 후 특이사항 공유 /
미납 관리비 확인 / 시세 및 낙찰가 조사 /
점유자 현황 파악 / 명도 가능 여부 확인`;

export default function Cooperation() {
  const { user } = useAuthStore();
  const { branches } = useBranches();
  const [requests, setRequests] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  // 작성 폼
  const [formCourt, setFormCourt] = useState('');
  const [formYear, setFormYear] = useState(String(new Date().getFullYear()));
  const [formType, setFormType] = useState('타경');
  const [formNumber, setFormNumber] = useState('');
  const [formBranch, setFormBranch] = useState('');
  const [formReceiver, setFormReceiver] = useState('');
  const [formContent, setFormContent] = useState(DEFAULT_CONTENT);

  // 답변 폼
  const [replyContent, setReplyContent] = useState('');
  const [replyPhotos, setReplyPhotos] = useState<{ file_name: string; file_data: string; file_size: number }[]>([]);
  const [replying, setReplying] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    api.journal.members().then(res => setMembers((res.members || []).filter((m: any) => m.login_type !== 'freelancer' && m.role !== 'freelancer'))).catch(() => {});
    load();
    // URL 파라미터에서 법원/사건번호 자동 입력 (대시보드 퀵바)
    const courtParam = searchParams.get('court');
    const caseNoParam = searchParams.get('case_no');
    if (courtParam || caseNoParam) {
      setShowForm(true);
      if (courtParam) setFormCourt(courtParam);
      if (caseNoParam) {
        // 사건번호 파싱: 2026타경12345 → year=2026, type=타경, number=12345
        const match = caseNoParam.match(/(\d{4})(타경|경)(\d+)/);
        if (match) { setFormYear(match[1]); setFormType(match[2]); setFormNumber(match[3]); }
      }
      setSearchParams({}, { replace: true }); // URL 파라미터 제거
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.cooperation.list(filter);
      setRequests(res.requests || []);
    } catch { setRequests([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filter]);

  const loadDetail = async (id: string) => {
    try {
      const res = await api.cooperation.get(id);
      setDetail(res);
      setDetailId(id);
    } catch (err: any) { alert(err.message); }
  };

  const handleCreate = async () => {
    if (!formReceiver) { alert('수신자를 선택하세요.'); return; }
    try {
      await api.cooperation.create({
        receiver_id: formReceiver, court: formCourt,
        case_year: formYear, case_type: formType, case_number: formNumber,
        content: formContent,
      });
      setShowForm(false); setFormNumber(''); setFormReceiver(''); setFormContent(DEFAULT_CONTENT);
      load();
    } catch (err: any) { alert(err.message); }
  };

  const handleAccept = async (id: string) => {
    try { await api.cooperation.accept(id); load(); if (detailId === id) loadDetail(id); }
    catch (err: any) { alert(err.message); }
  };

  const handleComplete = async (id: string) => {
    if (!confirm('완료 처리하시겠습니까?')) return;
    try { await api.cooperation.complete(id); load(); if (detailId === id) loadDetail(id); }
    catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try { await api.cooperation.delete(id); load(); if (detailId === id) { setDetailId(null); setDetail(null); } }
    catch (err: any) { alert(err.message); }
  };

  // 사진 선택 + 자동 압축 (최대 1600px, JPEG 75%)
  const compressImage = (file: File): Promise<{ file_name: string; file_data: string; file_size: number }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1600;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.75);
          const size = Math.round(compressed.length * 3 / 4); // base64 → bytes 추정
          resolve({ file_name: file.name.replace(/\.[^.]+$/, '.jpg'), file_data: compressed, file_size: size });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newPhotos: typeof replyPhotos = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { alert(`${file.name}: 10MB 초과`); continue; }
      const compressed = await compressImage(file);
      newPhotos.push(compressed);
    }
    setReplyPhotos(prev => [...prev, ...newPhotos]);
    e.target.value = '';
  };

  const handleReply = async () => {
    if (!replyContent.trim() && replyPhotos.length === 0) { alert('내용 또는 사진을 입력하세요.'); return; }
    setReplying(true);
    try {
      await api.cooperation.reply(detailId!, { content: replyContent, photos: replyPhotos });
      setReplyContent(''); setReplyPhotos([]);
      loadDetail(detailId!); load();
    } catch (err: any) { alert(err.message); }
    finally { setReplying(false); }
  };

  const handleDownloadPhoto = async (photoId: string, fileName: string) => {
    try {
      const res = await api.cooperation.getPhoto(photoId);
      const a = document.createElement('a');
      a.href = res.photo.file_data;
      a.download = fileName;
      a.click();
    } catch (err: any) { alert(err.message); }
  };

  const filteredMembers = formBranch ? members.filter(m => m.branch === formBranch) : members;
  const receiverOpts = filteredMembers.filter(m => m.id !== user?.id).map(m => ({ value: m.id, label: `${m.name} ${m.position_title || ''} (${m.branch})` }));

  const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: '대기', color: '#e65100', bg: '#fff3e0' },
    accepted: { label: '수락', color: '#1a73e8', bg: '#e8f0fe' },
    completed: { label: '완료', color: '#188038', bg: '#e8f5e9' },
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2><Handshake size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 업무협조요청</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={14} /> 새 요청
        </button>
      </div>

      {/* 필터 */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        {['all', 'received', 'sent'].map(f => (
          <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? '전체' : f === 'received' ? '수신함' : '발신함'}
          </button>
        ))}
      </div>

      {/* 작성 폼 */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>업무협조요청 작성</h3>
            <button className="btn-icon" onClick={() => setShowForm(false)}><X size={16} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="form-label">법원</label>
              <Select size="sm" options={COURTS.map(c => ({ value: c, label: c }))}
                value={COURTS.map(c => ({ value: c, label: c })).find(o => o.value === formCourt) || null}
                onChange={(o: any) => setFormCourt(o?.value || '')} placeholder="법원 선택" isClearable isSearchable />
            </div>
            <div>
              <label className="form-label">사건번호</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select className="form-input" value={formYear} onChange={e => setFormYear(e.target.value)} style={{ width: 80 }}>
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select className="form-input" value={formType} onChange={e => setFormType(e.target.value)} style={{ width: 70 }}>
                  <option value="타경">타경</option>
                  <option value="경">경</option>
                </select>
                <input className="form-input" value={formNumber} onChange={e => setFormNumber(e.target.value)}
                  placeholder="사건번호" style={{ flex: 1 }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="form-label">수신 지사</label>
              <Select size="sm" options={[{ value: '', label: '전체' }, ...branches.map(b => ({ value: b, label: b }))]}
                value={branches.map(b => ({ value: b, label: b })).find(o => o.value === formBranch) || { value: '', label: '전체' }}
                onChange={(o: any) => { setFormBranch(o?.value || ''); setFormReceiver(''); }} isClearable />
            </div>
            <div>
              <label className="form-label">수신자</label>
              <Select size="sm" options={receiverOpts}
                value={receiverOpts.find(o => o.value === formReceiver) || null}
                onChange={(o: any) => setFormReceiver(o?.value || '')} placeholder="담당자 선택" isSearchable />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="form-label">요청 내용</label>
            <textarea className="form-input" value={formContent} onChange={e => setFormContent(e.target.value)}
              rows={5} style={{ width: '100%', resize: 'vertical' }} />
          </div>

          <button className="btn btn-primary" onClick={handleCreate}>
            <Send size={14} /> 요청 발송
          </button>
        </div>
      )}

      {/* 목록 */}
      {loading ? <div className="page-loading">로딩중...</div> : (
        requests.length === 0 ? (
          <div className="empty-state" style={{ padding: 40 }}>업무협조요청 내역이 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.map((r: any) => {
              const st = STATUS_MAP[r.status] || STATUS_MAP.pending;
              const isSender = r.sender_id === user?.id;
              const caseNo = r.case_number ? `${r.case_year}${r.case_type}${r.case_number}` : '';
              return (
                <div key={r.id} className="card" style={{ padding: '14px 18px', cursor: 'pointer', borderLeft: `3px solid ${st.color}` }}
                  onClick={() => loadDetail(r.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                      <span style={{ fontSize: '0.72rem', color: isSender ? '#1a73e8' : '#e65100', fontWeight: 600 }}>{isSender ? '발신' : '수신'}</span>
                      {r.court && <span style={{ fontSize: '0.78rem', color: '#5f6368' }}>{r.court}</span>}
                      {caseNo && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{caseNo}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: '#9aa0a6' }}>
                      {r.reply_count > 0 && <span>답변 {r.reply_count}</span>}
                      {r.photo_count > 0 && <span><Camera size={12} /> {r.photo_count}</span>}
                      <span>{r.created_at?.slice(0, 10)}</span>
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#3c4043' }}>
                    {isSender
                      ? <span>→ {r.receiver_name} {r.receiver_position} ({r.receiver_branch})</span>
                      : <span>← {r.sender_name} {r.sender_position} ({r.sender_branch})</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* 상세 팝업 */}
      {detailId && detail && (
        <div className="modal-overlay" onClick={() => { setDetailId(null); setDetail(null); setReplyContent(''); setReplyPhotos([]); }}>
          <div className="journal-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
            <div className="journal-popup-header">
              <h3 style={{ margin: 0 }}>업무협조요청 상세</h3>
              <button className="btn-close" onClick={() => { setDetailId(null); setDetail(null); }}>×</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {/* 요청 정보 */}
              {(() => {
                const req = detail.request;
                const st = STATUS_MAP[req.status] || STATUS_MAP.pending;
                const caseNo = req.case_number ? `${req.case_year}${req.case_type}${req.case_number}` : '';
                const isSender = req.sender_id === user?.id;
                const isReceiver = req.receiver_id === user?.id;
                return (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ padding: '3px 12px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                      {req.court && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#3c4043' }}>{req.court}</span>}
                      {caseNo && <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1a1a2e' }}>{caseNo}</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, fontSize: '0.82rem' }}>
                      <div><span style={{ color: '#9aa0a6' }}>발신:</span> {req.sender_name} {req.sender_position} ({req.sender_branch})</div>
                      <div><span style={{ color: '#9aa0a6' }}>수신:</span> {req.receiver_name} {req.receiver_position} ({req.receiver_branch})</div>
                    </div>
                    <div style={{ padding: 12, background: '#f8f9fa', borderRadius: 8, marginBottom: 16, fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {req.content || '(내용 없음)'}
                    </div>

                    {/* 수락 버튼 */}
                    {isReceiver && req.status === 'pending' && (
                      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => handleAccept(req.id)}>
                        <Check size={14} /> 요청 수락
                      </button>
                    )}
                    {/* 완료 버튼 */}
                    {(isSender || isReceiver) && req.status === 'accepted' && (
                      <button className="btn btn-sm" style={{ marginBottom: 16, color: '#188038', border: '1px solid #188038' }} onClick={() => handleComplete(req.id)}>
                        <Check size={14} /> 완료 처리
                      </button>
                    )}
                    {/* 삭제 */}
                    {isSender && (
                      <button className="btn btn-sm btn-danger" style={{ marginBottom: 16, marginLeft: 8 }} onClick={() => handleDelete(req.id)}>
                        <Trash2 size={12} /> 삭제
                      </button>
                    )}
                  </>
                );
              })()}

              {/* 답변 목록 */}
              {detail.replies?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: '#3c4043' }}>답변 내역</div>
                  {detail.replies.map((reply: any) => {
                    const isMe = reply.author_id === user?.id;
                    const replyPhotos = (detail.photos || []).filter((p: any) => p.reply_id === reply.id);
                    return (
                      <div key={reply.id} style={{
                        padding: 12, borderRadius: 8, marginBottom: 8,
                        background: isMe ? '#e8f0fe' : '#f0fdf4',
                        borderLeft: `3px solid ${isMe ? '#1a73e8' : '#188038'}`,
                      }}>
                        <div style={{ fontSize: '0.75rem', color: '#9aa0a6', marginBottom: 4 }}>
                          {reply.author_name} {reply.author_position} · {reply.created_at?.slice(0, 16)}
                        </div>
                        {reply.content && <div style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{reply.content}</div>}
                        {replyPhotos.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                            {replyPhotos.map((p: any) => (
                              <button key={p.id} className="btn btn-sm" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                                onClick={() => handleDownloadPhoto(p.id, p.file_name)}>
                                <Download size={12} /> {p.file_name} ({Math.round(p.file_size / 1024)}KB)
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 답변 작성 */}
              {detail.request.status !== 'completed' && (
                <div style={{ borderTop: '1px solid #e8eaed', paddingTop: 12 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>답변 작성</div>
                  <textarea className="form-input" value={replyContent} onChange={e => setReplyContent(e.target.value)}
                    rows={3} placeholder="답변 내용을 입력하세요" style={{ width: '100%', marginBottom: 8 }} />

                  {/* 사진 미리보기 */}
                  {replyPhotos.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {replyPhotos.map((p, i) => (
                        <div key={i} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px solid #e8eaed' }}>
                          <img src={p.file_data} alt={p.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <button style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => setReplyPhotos(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Camera size={14} /> 사진 첨부
                      <input type="file" accept="image/*" multiple capture="environment" onChange={handlePhotoSelect} style={{ display: 'none' }} />
                    </label>
                    <button className="btn btn-sm btn-primary" onClick={handleReply} disabled={replying}>
                      {replying ? '전송중...' : '답변 전송'}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#9aa0a6', marginTop: 6 }}>사진: 자동 압축, 다중 선택 가능 (원본 10MB까지)</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
