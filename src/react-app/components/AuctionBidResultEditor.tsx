import { useEffect, useState } from 'react';
import { AlertTriangle, Trophy } from 'lucide-react';
import { api } from '../api';
import type { AuctionBidResultEntry, AuctionBidScheduleSaveResponse } from '../api';
import { auctionScheduleBidResult, type AuctionScheduleBidResult } from '../../shared/auction-schedule';

export type { AuctionBidResultEntry } from '../api';

type ResultChoice = AuctionScheduleBidResult;

function parseData(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function currency(value: unknown): string {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits).toLocaleString('ko-KR') : '';
}

function won(value: string): number {
  return Number(value.replace(/[^0-9]/g, '')) || 0;
}

function phone(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function AuctionBidResultEditor({
  entry,
  initialResult,
  priceOnly = false,
  blocking = false,
  onSaved,
  onClose,
}: {
  entry: AuctionBidResultEntry;
  initialResult?: ResultChoice;
  priceOnly?: boolean;
  blocking?: boolean;
  onSaved: (saved?: AuctionBidScheduleSaveResponse) => void | Promise<void>;
  onClose?: () => void;
}) {
  const data = parseData(entry.data);
  const currentResult = initialResult ?? auctionScheduleBidResult(data);
  const initialChoice: ResultChoice | '' = blocking || currentResult === 'pending' ? '' : 'pending';
  const [result, setResult] = useState<ResultChoice | ''>(initialChoice);
  const [suggestedPrice, setSuggestedPrice] = useState(currency(data.suggestedPrice));
  const [actualBidPrice, setActualBidPrice] = useState(currency(data.bidPrice));
  const [winningPrice, setWinningPrice] = useState(currency(data.winPrice));
  const [clientPhone, setClientPhone] = useState(phone(data.clientPhone));
  const [contractPhones, setContractPhones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = parseData(entry.data);
    const nextCurrentResult = initialResult ?? auctionScheduleBidResult(next);
    setResult(blocking || nextCurrentResult === 'pending' ? '' : 'pending');
    setSuggestedPrice(currency(next.suggestedPrice));
    setActualBidPrice(currency(next.bidPrice));
    setWinningPrice(currency(next.winPrice));
    setClientPhone(phone(next.clientPhone));
  }, [entry.id, entry.data, initialResult, blocking]);

  useEffect(() => {
    const entryData = parseData(entry.data);
    const customerName = String(entryData.bidder || entryData.client || '').trim();
    if (!customerName) {
      setContractPhones([]);
      return;
    }
    let cancelled = false;
    api.sales.customerContracts({ client_name: customerName, user_id: entry.user_id })
      .then(({ contracts }) => {
        if (cancelled) return;
        const unique = [...new Map(contracts.map(contract => [String(contract.client_phone || '').replace(/\D/g, ''), phone(contract.client_phone)])).values()]
          .filter(Boolean);
        setContractPhones(unique);
        if (unique.length === 1 && !String(entryData.clientPhone || '').trim()) setClientPhone(unique[0]);
      })
      .catch(() => { if (!cancelled) setContractPhones([]); });
    return () => { cancelled = true; };
  }, [entry.id, entry.user_id, entry.data]);

  const submit = async () => {
    if (priceOnly) {
      if (!won(suggestedPrice) && !won(actualBidPrice) && !won(winningPrice)) {
        alert('제안입찰가·작성입찰가·최종 낙찰가 중 하나 이상 입력해 주세요.');
        return;
      }
      setSaving(true);
      try {
        const saved = await api.auctionSchedule.updateBidPrices(entry.id, {
          suggested_price: won(suggestedPrice),
          actual_bid_price: won(actualBidPrice),
          winning_price: won(winningPrice),
        });
        await onSaved(saved);
      } catch (error: unknown) {
        alert(errorMessage(error, '입찰가를 저장하지 못했습니다.'));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!result) {
      alert('낙찰·실패·취하/변경·취소 중 결과를 선택해 주세요.');
      return;
    }
    if (['won', 'failed'].includes(result) && (!won(suggestedPrice) || !won(actualBidPrice) || !won(winningPrice))) {
      alert('제안입찰가·작성입찰가·최종 낙찰가를 모두 입력해 주세요.');
      return;
    }
    if (result === 'pending' && !confirm('현재 입찰 결과를 대기 상태로 초기화할까요? 연결된 입금신청이 있으면 서버 정책에 따라 초기화가 제한될 수 있습니다.')) {
      return;
    }
    setSaving(true);
    try {
      const saved = await api.auctionSchedule.setBidResult(entry.id, {
        result,
        suggested_price: won(suggestedPrice),
        actual_bid_price: won(actualBidPrice),
        winning_price: won(winningPrice),
        client_phone: result === 'won' ? clientPhone : undefined,
      });
      if (result === 'won') {
        alert(saved.phone_required
          ? '낙찰 업무성과가 입금대기로 등록되었습니다. 고객 전화번호가 비어 있습니다. 대시보드의 고객 전화번호 등록 알림에서 반드시 보완해 주세요.'
          : '낙찰 처리와 업무성과 입금대기 등록이 완료되었습니다.');
      }
      await onSaved(saved);
    } catch (error: unknown) {
      alert(errorMessage(error, '입찰 결과를 저장하지 못했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`auction-bid-result-editor ${blocking ? 'blocking' : ''}`} aria-labelledby={`auction-bid-result-title-${entry.id}`}>
      <div className="auction-bid-result-editor-head">
        <div>
          <span className="auction-bid-result-kicker"><AlertTriangle size={15} /> {priceOnly ? '입찰가 작성' : blocking ? '입찰 결과 필수 입력' : '입찰 결과 입력/수정'}</span>
          <h3 id={`auction-bid-result-title-${entry.id}`}>{entry.target_date} · {entry.activity_subtype || String(data.caseNo || '') || '입찰 일정'}</h3>
          {entry.missing_fields?.length ? <p>미입력: {entry.missing_fields.join(', ')}</p> : null}
        </div>
        {!blocking && onClose ? <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button> : null}
      </div>

      {!priceOnly && (
        <div className="auction-bid-result-choice" role="group" aria-label="입찰 결과 선택">
          {(blocking || currentResult === 'pending') && (
            <>
              <button type="button" className={result === 'won' ? 'active won' : ''} onClick={() => setResult('won')}><Trophy size={15} /> 낙찰</button>
              <button type="button" className={result === 'failed' ? 'active failed' : ''} onClick={() => setResult('failed')}>실패</button>
              <button type="button" className={result === 'withdrawn' ? 'active withdrawn' : ''} onClick={() => setResult('withdrawn')}>취하/변경</button>
              <button type="button" className={result === 'cancelled' ? 'active cancelled' : ''} onClick={() => setResult('cancelled')}>취소</button>
            </>
          )}
          {!blocking && currentResult !== 'pending' && (
            <button type="button" className={result === 'pending' ? 'active pending' : ''} onClick={() => setResult('pending')}>대기(결과 초기화)</button>
          )}
        </div>
      )}

      {(priceOnly || result === 'won' || result === 'failed') && (
        <div className="auction-bid-result-fields">
          <label><span>제안입찰가 *</span><input inputMode="numeric" value={suggestedPrice} onChange={(e) => setSuggestedPrice(currency(e.target.value))} placeholder="0" /></label>
          <label><span>작성입찰가 *</span><input inputMode="numeric" value={actualBidPrice} onChange={(e) => setActualBidPrice(currency(e.target.value))} placeholder="0" /></label>
          <label><span>최종 낙찰가 *</span><input inputMode="numeric" value={winningPrice} onChange={(e) => setWinningPrice(currency(e.target.value))} placeholder="0" /></label>
        </div>
      )}

      {!priceOnly && result === 'won' && (
        <div className="auction-bid-result-fields">
          <label><span>고객 전화번호 <small>(나중에 입력 가능)</small></span><input inputMode="tel" value={clientPhone} onChange={(e) => setClientPhone(phone(e.target.value))} list={contractPhones.length > 1 ? `auction-contract-phones-${entry.id}` : undefined} placeholder="미입력 시 대시보드에서 알림" maxLength={13} /></label>
          {contractPhones.length > 1 && <datalist id={`auction-contract-phones-${entry.id}`}>{contractPhones.map(value => <option key={value} value={value} />)}</datalist>}
        </div>
      )}

      {!priceOnly && result === 'withdrawn' && <p className="auction-bid-result-withdrawn-note">취하·변경으로 실제 입찰하지 않은 경우에는 입찰가와 낙찰가 입력이 면제됩니다.</p>}
      {!priceOnly && result === 'cancelled' && <p className="auction-bid-result-withdrawn-note">입찰 일정 자체가 취소된 경우입니다. 입찰가와 낙찰가 입력은 필요하지 않습니다.</p>}
      {!priceOnly && result === 'pending' && <p className="auction-bid-result-pending-note">등록된 결과를 해제하고 결과 대기 상태로 되돌립니다.</p>}
      <div className="auction-bid-result-editor-actions">
        <button type="button" className="btn btn-primary" disabled={saving || (!priceOnly && !result)} onClick={submit}>{saving ? '저장 중...' : priceOnly ? '입찰가 저장' : '입찰 결과 저장'}</button>
      </div>
    </section>
  );
}
