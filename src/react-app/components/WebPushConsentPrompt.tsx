import { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, MessageCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';
import {
  browserSupportsWebPush,
  clearWebPushPromptSuppression,
  currentWebPushSubscription,
  enableWebPush,
  webPushOptOutKey,
  webPushPostponeKey,
} from '../lib/webPushClient';

const POSTPONE_DAYS = 7;

export default function WebPushConsentPrompt() {
  const user = useAuthStore((state) => state.user);
  const [open, setOpen] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setOpen(false);
    setMessage('');
    if (!user?.id || !browserSupportsWebPush() || Notification.permission === 'denied') return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (localStorage.getItem(webPushOptOutKey(user.id)) === '1') return;
        const postponedUntil = Number(localStorage.getItem(webPushPostponeKey(user.id)) || 0);
        if (postponedUntil > Date.now()) return;

        const config = await api.webPush.config();
        if (!config.supported || !config.public_key) return;
        const current = await currentWebPushSubscription();
        if (current) {
          const ownership = await api.webPush.currentSubscription(current.endpoint);
          if (ownership.owned && ownership.active) return;
        }
        if (!cancelled) {
          setPublicKey(config.public_key);
          setOpen(true);
        }
      } catch {
        // 알림 진단 장애가 로그인 자체를 방해하지 않도록 팝업만 생략한다.
      }
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [user?.id]);

  if (!user || !open) return null;

  const postpone = () => {
    localStorage.setItem(webPushPostponeKey(user.id), String(Date.now() + POSTPONE_DAYS * 86400000));
    setOpen(false);
  };

  const enable = async () => {
    setBusy(true);
    setMessage('');
    try {
      await enableWebPush(publicKey);
      clearWebPushPromptSuppression(user.id);
      setMessage('이 기기의 업무 알림 연결이 완료되었습니다.');
      window.setTimeout(() => setOpen(false), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '알림 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay web-push-consent-overlay" role="presentation">
      <section className="web-push-consent-card" role="dialog" aria-modal="true" aria-labelledby="web-push-consent-title">
        <div className="web-push-consent-icon"><BellRing size={28} /></div>
        <div className="web-push-consent-heading">
          <span>새 기기 알림 설정</span>
          <h2 id="web-push-consent-title">이 기기에서 업무 알림을 받으시겠습니까?</h2>
          <p>사용자관리에서 따로 설정하지 않아도, 지금 로그인한 계정으로 현재 기기만 연결됩니다.</p>
        </div>

        <div className="web-push-consent-items">
          <div><MessageCircle size={18} /><span><strong>내 글의 댓글·법률 답변</strong><small>내가 작성한 글에 새 답변이 등록될 때</small></span></div>
          <div><CheckCircle2 size={18} /><span><strong>나를 지정한 1:1 업무 알림</strong><small>메시지·명도견적·법률지원·업무협조 요청</small></span></div>
          <div><ShieldCheck size={18} /><span><strong>필요한 알림만 발송</strong><small>전체 커뮤니티 게시글은 일괄 발송하지 않습니다.</small></span></div>
        </div>

        {/iPhone|iPad|iPod/i.test(navigator.userAgent) && (
          <p className="web-push-consent-ios">iPhone/iPad는 먼저 홈 화면에 추가한 앱에서 실행해야 알림을 연결할 수 있습니다.</p>
        )}
        {message && <p className={`web-push-consent-message ${message.includes('완료') ? 'is-success' : 'is-error'}`}>{message}</p>}

        <div className="web-push-consent-actions">
          <button type="button" className="btn" onClick={postpone} disabled={busy}>나중에</button>
          <button type="button" className="btn btn-primary" onClick={enable} disabled={busy || !publicKey}>
            <BellRing size={16} /> {busy ? '연결 중...' : '알림 받기'}
          </button>
        </div>
        <p className="web-push-consent-footnote">‘나중에’를 선택하면 7일 후 다시 안내합니다. 마이페이지에서 언제든 변경할 수 있습니다.</p>
      </section>
    </div>
  );
}
