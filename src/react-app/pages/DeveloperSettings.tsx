import { useEffect, useMemo, useState } from 'react';
import { Bot, FolderLock, RefreshCw, Search } from 'lucide-react';
import { api, type CodexConversationDetail, type CodexConversationSummary } from '../api';

function formatDate(value: string): string {
  if (!value) return '-';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ko-KR');
}

export default function DeveloperSettings() {
  const [items, setItems] = useState<CodexConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<CodexConversationDetail | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const loadList = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.developerSettings.codexConversations();
      const conversations = response.conversations || [];
      setItems(conversations);
      setSelectedId((current) => current && conversations.some((item) => item.id === current)
        ? current
        : conversations[0]?.id || '');
    } catch (err: any) {
      setError(err?.message || '대화 로그를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadList(); }, []);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    setDetailLoading(true);
    api.developerSettings.codexConversation(selectedId)
      .then((response) => { if (active) setDetail(response.conversation); })
      .catch((err: any) => { if (active) setError(err?.message || '대화 내용을 불러오지 못했습니다.'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko-KR');
    if (!keyword) return items;
    return items.filter((item) => [item.title, item.working_directory, item.source_session_id]
      .some((value) => String(value || '').toLocaleLowerCase('ko-KR').includes(keyword)));
  }, [items, search]);

  return (
    <div className="page developer-settings-page">
      <div className="page-header developer-settings-header">
        <div>
          <h2><FolderLock size={23} /> 개발자 설정</h2>
          <p className="page-desc">마스터 계정만 접근할 수 있는 Codex 대화 기록 보관함입니다.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadList} disabled={loading}>
          <RefreshCw size={16} /> 새로고침
        </button>
      </div>

      <div className="developer-security-notice">
        <FolderLock size={18} />
        <span>메뉴와 API 모두 마스터 전용입니다. 내부 추론·도구 출력은 저장하지 않고, 토큰과 비밀번호 패턴은 자동 마스킹합니다.</span>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="developer-log-layout">
        <aside className="developer-log-sidebar">
          <label className="developer-log-search">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="대화 검색" />
          </label>
          <div className="developer-log-list">
            {loading ? <div className="developer-log-empty">불러오는 중...</div> : filtered.length === 0 ? (
              <div className="developer-log-empty">보관된 대화가 없습니다.</div>
            ) : filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`developer-log-item ${selectedId === item.id ? 'active' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{formatDate(item.last_message_at)} · {item.message_count}개 메시지</span>
                {item.working_directory && <small>{item.working_directory}</small>}
              </button>
            ))}
          </div>
        </aside>

        <section className="developer-transcript">
          {detailLoading ? <div className="developer-log-empty">대화 내용을 불러오는 중...</div> : !detail ? (
            <div className="developer-log-empty"><Bot size={30} />왼쪽에서 대화를 선택해 주세요.</div>
          ) : (
            <>
              <header className="developer-transcript-header">
                <div><Bot size={20} /><strong>{detail.title}</strong></div>
                <span>{formatDate(detail.started_at)} · Codex {detail.client_version || ''}</span>
              </header>
              <div className="developer-message-list">
                {detail.messages.map((message) => (
                  <article key={message.id} className={`developer-message ${message.role}`}>
                    <div className="developer-message-meta">
                      <strong>{message.role === 'user' ? '사용자' : 'Codex'}</strong>
                      <span>{formatDate(message.created_at)}</span>
                    </div>
                    <pre>{message.content}</pre>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
