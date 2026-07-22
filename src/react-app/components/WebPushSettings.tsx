import { useEffect, useState } from 'react';
import { Bell, BellOff, Send, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../api';
import type { WebPushDiagnostics, WebPushSubscriptionInfo } from '../api';
import { useAuthStore } from '../store';
import { browserSupportsWebPush, clearWebPushPromptSuppression, enableWebPush, webPushOptOutKey } from '../lib/webPushClient';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function WebPushSettings() {
  const user = useAuthStore((state) => state.user);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [permission, setPermission] = useState<NotificationPermission>(() => 'Notification' in window ? Notification.permission : 'denied');
  const [enabledHere, setEnabledHere] = useState(false);
  const [devices, setDevices] = useState<WebPushSubscriptionInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState<WebPushDiagnostics | null>(null);

  const refresh = async () => {
    if (!user || !browserSupportsWebPush()) {
      setSupported(false);
      setReason('browser_not_supported');
      return;
    }
    try {
      const config = await api.webPush.config();
      setSupported(config.supported);
      setReason(config.reason || '');
      setPublicKey(config.public_key || '');
      setPermission(Notification.permission);
      if (!config.supported) return;
      const registration = await navigator.serviceWorker.getRegistration('/');
      setEnabledHere(Boolean(await registration?.pushManager.getSubscription()));
      const stored = await api.webPush.subscriptions();
      setDevices(stored.subscriptions || []);
      if (user.role === 'master') setDiagnostics(await api.webPush.diagnostics());
    } catch (error: unknown) {
      setMessage(errorMessage(error, '웹푸시 상태를 확인하지 못했습니다.'));
    }
  };

  useEffect(() => {
    void refresh();
    // Only refresh when the signed-in identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const enable = async () => {
    if (!publicKey) return;
    setBusy(true);
    setMessage('');
    try {
      await enableWebPush(publicKey);
      if (user?.id) clearWebPushPromptSuppression(user.id);
      setPermission(Notification.permission);
      setMessage('이 기기의 웹푸시 알림을 연결했습니다.');
      await refresh();
    } catch (error: unknown) {
      setMessage(errorMessage(error, '웹푸시 연결에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.webPush.unsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setEnabledHere(false);
      if (user?.id) localStorage.setItem(webPushOptOutKey(user.id), '1');
      setMessage('이 기기의 웹푸시 알림을 해제했습니다.');
      await refresh();
    } catch (error: unknown) {
      setMessage(errorMessage(error, '웹푸시 해제에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const selfTest = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.webPush.selfTest();
      setMessage(`시험 알림 발송 완료: 성공 ${result.sent || 0}건, 실패 ${result.failed || 0}건`);
      await refresh();
    } catch (error: unknown) {
      setMessage(errorMessage(error, '시험 알림 발송에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <div className="profile-section web-push-section">
        <div className="web-push-title">
          <div><Bell size={20} /><h3>웹푸시 알림</h3></div>
          <span className={`web-push-status ${enabledHere ? 'is-on' : ''}`}>
            {enabledHere ? '이 기기 연결됨' : '연결 안 됨'}
          </span>
        </div>
        <p className="web-push-description">사이트를 닫아도 업무 알림을 받을 수 있도록 이 브라우저를 연결합니다. 기기별로 직접 허용해야 합니다.</p>

        {supported === false ? (
          <div className="web-push-notice">
            {reason === 'not_configured'
              ? '서버 알림키가 아직 설정되지 않아 현재는 연결할 수 없습니다.'
              : '이 브라우저에서는 웹푸시 알림을 사용할 수 없습니다.'}
          </div>
        ) : (
          <>
            <div className="web-push-actions">
              {!enabledHere ? (
                <button className="btn btn-primary" onClick={enable} disabled={busy || supported !== true}>
                  <Bell size={15} /> 이 기기 알림 연결
                </button>
              ) : (
                <button className="btn" onClick={disable} disabled={busy}>
                  <BellOff size={15} /> 이 기기 연결 해제
                </button>
              )}
              <button className="btn" onClick={selfTest} disabled={busy || !enabledHere}>
                <Send size={15} /> 시험 알림 보내기
              </button>
            </div>
            {permission === 'denied' && <div className="web-push-notice is-error">브라우저 설정에서 이 사이트의 알림 권한을 다시 허용해야 합니다.</div>}
            {/iPhone|iPad|iPod/i.test(navigator.userAgent) && (
              <div className="web-push-notice">iPhone/iPad는 먼저 브라우저 메뉴에서 ‘홈 화면에 추가’한 뒤 설치된 앱에서 알림을 연결하세요.</div>
            )}
            {devices.length > 0 && (
              <div className="web-push-devices">
                <strong><Smartphone size={14} /> 내 연결 기기 {devices.filter((item) => item.active).length}대</strong>
                {devices.slice(0, 5).map((item) => (
                  <span key={item.id}>{item.device_label || '웹 브라우저'} · {item.active ? '사용 중' : '만료됨'}</span>
                ))}
              </div>
            )}
          </>
        )}
        {message && <div className="web-push-message">{message}</div>}
      </div>

      {user.role === 'master' && diagnostics && (
        <div className="profile-section web-push-section">
          <div className="web-push-title">
            <div><ShieldCheck size={20} /><h3>웹푸시 통합진단</h3></div>
            <span className="profile-readonly-tag">마스터 전용</span>
          </div>
          <div className="web-push-summary">
            <div><strong>{Number(diagnostics.summary.active || 0)}</strong><span>활성 기기</span></div>
            <div><strong>{Number(diagnostics.summary.active_users || 0)}</strong><span>연결 인원</span></div>
            <div><strong>{Number(diagnostics.summary.total || 0)}</strong><span>누적 기기</span></div>
          </div>
          <div className="web-push-diagnostic-list">
            {diagnostics.recent.length === 0 ? <span>아직 발송 진단 기록이 없습니다.</span> : diagnostics.recent.slice(0, 10).map((item) => (
              <div key={item.id}>
                <span className={`web-push-result ${item.status}`}>{item.status === 'sent' ? '성공' : '실패'}</span>
                <span>{item.user_name || '탈퇴 사용자'} · {item.device_label || item.provider || '기기'}</span>
                <time>{item.created_at}</time>
                {item.error_code && <code>{item.error_code}</code>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
