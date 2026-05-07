import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { Link2, AlertTriangle, Check, X } from 'lucide-react';

type Candidate = {
  id: string; document_id: string; doc_title: string; doc_status: string; doc_created_at: string;
  author_id: string; author_name: string; match_tier: number;
  body_outing_text: string | null; body_outing_parsed: string | null;
  candidates: Array<{ id: string; target_date: string; activity_type: string; activity_subtype: string;
    time_from: string; time_to: string; place: string; case_no: string; client: string }>;
  created_at: string;
};

export default function LinkReview() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<Candidate[]>([]);
  const [tab, setTab] = useState<'pending' | 'resolved' | 'skipped'>('pending');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.links.reviewQueue(tab);
      setItems(res.items);
      // 기본 선택: tier가 명확한 후보가 1개면 자동 체크
      const initSel: Record<string, Set<string>> = {};
      for (const it of res.items) {
        if (tab !== 'pending') continue;
        // 본문 일자가 있고 후보 entry 중 같은 날짜가 있으면 자동 선택
        const exact = it.body_outing_parsed
          ? it.candidates.filter((c) => c.target_date === it.body_outing_parsed)
          : [];
        if (exact.length > 0) initSel[it.id] = new Set(exact.map((c) => c.id));
        else initSel[it.id] = new Set();
      }
      setSelected(initSel);
    } catch (err: any) {
      alert('로딩 실패: ' + (err.message || ''));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [tab]);

  if (!user || !['master', 'accountant', 'admin'].includes(user.role)) {
    return <div style={{ padding: 40 }}>접근 권한이 없습니다.</div>;
  }

  const toggleEntry = (candId: string, entryId: string) => {
    setSelected((prev) => {
      const cur = new Set(prev[candId] || []);
      if (cur.has(entryId)) cur.delete(entryId);
      else cur.add(entryId);
      return { ...prev, [candId]: cur };
    });
  };

  const handleResolve = async (candId: string) => {
    const ids = Array.from(selected[candId] || []);
    if (ids.length === 0) {
      if (!confirm('선택된 entry가 없습니다. "매칭 안 됨"으로 처리할까요?')) return;
    } else {
      if (!confirm(`${ids.length}개 entry를 link로 연결하시겠습니까?`)) return;
    }
    try {
      await api.links.resolveReview(candId, ids);
      load();
    } catch (err: any) {
      alert('처리 실패: ' + (err.message || ''));
    }
  };

  const handleSkip = async (candId: string) => {
    if (!confirm('"매칭 안 됨"으로 처리하시겠습니까?')) return;
    try {
      await api.links.resolveReview(candId, []);
      load();
    } catch (err: any) {
      alert('처리 실패: ' + (err.message || ''));
    }
  };

  const tierColor = (t: number) => t === 3 ? '#f9ab00' : t === 4 ? '#d93025' : '#1a73e8';
  const tierLabel = (t: number) => t === 3 ? 'Tier 3 (±3일)' : t === 4 ? 'Tier 4 (regex 실패)' : `Tier ${t}`;
  const purposeColor = (a: string) => a === '입찰' ? '#d93025' : a === '임장' ? '#188038' : '#1a73e8';

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link2 size={24} color="#1a73e8" />
        <h2 style={{ margin: 0, fontSize: '1.3rem' }}>외근보고서 link 검수</h2>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#5f6368', marginBottom: 16 }}>
        Backfill 자동 매칭에 실패한 외근보고서를 검수하여 일지 entry와 연결합니다.
        선택 후 "연결" 버튼, 매칭 entry가 없으면 "매칭 안 됨"으로 처리합니다.
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['pending', 'resolved', 'skipped'] as const).map((t) => (
          <button key={t}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : ''}`}
            onClick={() => setTab(t)}>
            {t === 'pending' ? '대기' : t === 'resolved' ? '완료' : '매칭 없음'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>로딩 중...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>
          {tab === 'pending' ? '검수 대기 항목이 없습니다.' : '항목이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((it) => (
            <div key={it.id} style={{
              border: '1px solid #e8eaed', borderRadius: 8, padding: 14,
              background: '#fff'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
                      background: tierColor(it.match_tier) + '22', color: tierColor(it.match_tier), fontWeight: 600
                    }}>
                      {tierLabel(it.match_tier)}
                    </span>
                    <span style={{ fontWeight: 600 }}>{it.doc_title}</span>
                    <span style={{ fontSize: '0.78rem', color: '#5f6368' }}>— {it.author_name}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#5f6368', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div>작성일: {(it.doc_created_at || '').slice(0, 16)}</div>
                    {it.body_outing_text && (
                      <div>본문 외근일자: <code style={{ background: '#f1f3f4', padding: '0 4px', borderRadius: 3 }}>
                        {it.body_outing_text.replace(/외근\s*일자[\s:：]*/, '').slice(0, 30)}
                      </code> → 파싱: <strong style={{ color: it.body_outing_parsed ? '#188038' : '#d93025' }}>
                        {it.body_outing_parsed || '추출 실패'}
                      </strong></div>
                    )}
                    <a href={`/documents/${it.document_id}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#1a73e8' }}>→ 문서 본문 열기</a>
                  </div>
                </div>
                {tab === 'pending' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => handleResolve(it.id)}>
                      <Check size={13} /> 연결 ({(selected[it.id]?.size || 0)}건)
                    </button>
                    <button className="btn btn-sm" onClick={() => handleSkip(it.id)}
                      style={{ color: '#d93025', borderColor: '#d93025' }}>
                      <X size={13} /> 매칭 없음
                    </button>
                  </div>
                )}
              </div>

              {it.candidates.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: '#9aa0a6', padding: 8, background: '#f8f9fa', borderRadius: 4 }}>
                  <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  후보 entry가 없습니다.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>
                    후보 외근 entries ({it.candidates.length}건):
                  </div>
                  {it.candidates.map((c) => {
                    const isSelected = selected[it.id]?.has(c.id) || false;
                    const matchesBody = it.body_outing_parsed === c.target_date;
                    return (
                      <label key={c.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 4,
                        background: isSelected ? '#e8f0fe' : (matchesBody ? '#fef7e0' : '#fafafa'),
                        border: isSelected ? '1px solid #1a73e8' : '1px solid #e8eaed',
                        cursor: tab === 'pending' ? 'pointer' : 'default', fontSize: '0.78rem'
                      }}>
                        {tab === 'pending' && (
                          <input type="checkbox" checked={isSelected}
                            onChange={() => toggleEntry(it.id, c.id)} />
                        )}
                        <span style={{ minWidth: 90, color: '#3c4043', fontWeight: 600 }}>{c.target_date}</span>
                        <span style={{ minWidth: 40, color: purposeColor(c.activity_type), fontWeight: 600 }}>{c.activity_type}</span>
                        <span style={{ minWidth: 90, color: '#5f6368' }}>{c.time_from}{c.time_to ? `~${c.time_to}` : ''}</span>
                        <span style={{ flex: 1, color: '#5f6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.case_no || ''} {c.place || c.client || ''}
                        </span>
                        {matchesBody && (
                          <span style={{ fontSize: '0.66rem', color: '#188038', padding: '1px 6px', background: '#e8f5e9', borderRadius: 4, fontWeight: 600 }}>
                            본문 일자 일치
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
