import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import AuctionBidResultEditor, { type AuctionBidResultEntry } from './AuctionBidResultEditor';

export default function AuctionBidResultGate() {
  const { user } = useAuthStore();
  const [entries, setEntries] = useState<AuctionBidResultEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const isFreelancer = (user as any)?.login_type === 'freelancer' && user?.role !== 'master';

  const load = useCallback(async () => {
    if (!user || !isFreelancer) {
      setEntries([]);
      setLoaded(true);
      return;
    }
    try {
      const result = await api.auctionSchedule.myBidResultRequirements();
      setEntries(result.entries || []);
    } catch {
      // 일시적인 네트워크 오류만으로 전체 화면을 차단하지 않는다.
    } finally {
      setLoaded(true);
    }
  }, [user?.id, isFreelancer]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  if (!loaded || !entries.length) return null;
  const current = entries[0];
  return (
    <div className="auction-bid-result-gate" role="dialog" aria-modal="true" aria-label="입찰 결과 필수 입력">
      <div className="auction-bid-result-gate-backdrop" />
      <div className="auction-bid-result-gate-card">
        <div className="auction-bid-result-gate-notice">
          당일 오후 3시까지 입력되지 않은 입찰 결과가 있습니다. 입력을 완료해야 다른 업무를 계속할 수 있습니다.
          {entries.length > 1 ? <strong> 남은 항목 {entries.length}건</strong> : null}
        </div>
        <AuctionBidResultEditor entry={current} blocking onSaved={load} />
      </div>
    </div>
  );
}
