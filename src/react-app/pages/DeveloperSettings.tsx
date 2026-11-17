import { useEffect, useMemo, useState } from 'react';
import { Bot, Clock3, Database, FolderLock, RefreshCw, Save, Search, Terminal, Trash2 } from 'lucide-react';
import { api, type CodexConversationDetail, type CodexConversationSummary, type CodexSyncStatus } from '../api';

function formatDate(value: string | null): string {
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
  const [status, setStatus] = useState<CodexSyncStatus | null>(null);
  const [retentionDraft, setRetentionDraft] = useState('180');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const loadList = async () => {
    setLoading(true);
    setError('');
    try {
      const [response, syncStatus] = await Promise.all([
        api.developerSettings.codexConversations(),
        api.developerSettings.codexSyncStatus(),
      ]);
      const conversations = response.conversations || [];
      setItems(conversations);
      setStatus(syncStatus);
      setRetentionDraft(String(syncStatus.retention_days));
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

  const handleDelete = async () => {
    if (!detail || !window.confirm('이 Codex 대화 로그를 삭제할까요? 삭제 후 복구할 수 없습니다.')) return;
    try {
      await api.developerSettings.deleteCodexConversation(detail.id);
      setDetail(null);
      setSelectedId('');
      setNotice('대화 로그를 삭제했습니다.');
      await loadList();
    } catch (err: any) {
      setError(err?.message || '대화 로그를 삭제하지 못했습니다.');
    }
  };

  const handleRetentionSave = async () => {
    const days = Math.trunc(Number(retentionDraft));
    if (!Number.isFinite(days) || days < 30 || days > 3650) {
      setError('보존 기간은 30일 이상 3,650일 이하로 입력해 주세요.');
      return;
    }
    setSettingsSaving(true);
    setError('');
    try {
      const result = await api.developerSettings.updateCodexSyncSettings(days);
      setRetentionDraft(String(result.retention_days));
      setNotice(`보존 기간을 ${result.retention_days.toLocaleString('ko-KR')}일로 저장했습니다.`);
      await loadList();
    } catch (err: any) {
      setError(err?.message || '보존 기간을 저장하지 못했습니다.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const copySyncCommand = async () => {
    try {
      await navigator.clipboard.writeText('npm run codex:sync');
      setNotice('수동 동기화 명령을 복사했습니다. 저장소 터미널에서 실행해 주세요.');
    } catch {
      setNotice('수동 동기화 명령: npm run codex:sync');
    }
  };

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
      <section className="developer-sync-panel" aria-label="Codex 동기화 상태">
        <div className="developer-sync-stat"><Database size={17} /><span>저장 대화</span><strong>{status?.conversation_count ?? 0}건</strong></div>
        <div className="developer-sync-stat"><Clock3 size={17} /><span>마지막 동기화</span><strong>{formatDate(status?.latest_sync_at || null)}</strong></div>
        <div className="developer-sync-stat"><Terminal size={17} /><span>동기화 토큰</span><strong>{status?.active_token_count ? '활성' : '없음'}</strong></div>
        <div className="developer-sync-retention">
          <label htmlFor="codex-retention-days">보존 기간</label>
          <input id="codex-retention-days" type="number" min={30} max={3650} value={retentionDraft} onChange={(event) => setRetentionDraft(event.target.value)} />
          <span>일</span>
          <button type="button" className="btn btn-sm" onClick={handleRetentionSave} disabled={settingsSaving}><Save size={14} /> 저장</button>
        </div>
        <button type="button" className="btn btn-sm btn-secondary developer-sync-command" onClick={copySyncCommand}><Terminal size={14} /> 수동 동기화 명령 복사</button>
      </section>
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
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
                <div className="developer-transcript-actions">
                  <span>{formatDate(detail.started_at)} · Codex {detail.client_version || ''}</span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={handleDelete}><Trash2 size={14} /> 삭제</button>
                </div>
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
