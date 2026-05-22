import { useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { BID_PROPERTY_CATEGORIES, COURT_OPTIONS, generateYears } from '../journal/types';

type BidResult = '실패' | '낙찰' | '취소';

type FreelancerBid = {
  id: string;
  bid_date: string;
  court: string;
  case_number: string;
  item_no: string;
  client_name: string;
  bidder_name: string;
  property_type: string;
  suggested_price: number | null;
  actual_bid_price: number | null;
  winning_price: number | null;
  bid_result: BidResult;
  deviation_reason: string;
};

type FormState = {
  bid_date: string;
  bid_year: string;
  bid_case_no: string;
  item_no: string;
  court: string;
  client_name: string;
  bidder_name: string;
  property_main: string;
  property_type: string;
  suggested_price: string;
  actual_bid_price: string;
  winning_price: string;
  bid_result: BidResult;
  deviation_reason: string;
};

const years = generateYears().map(String);
const propertyMainOptions = BID_PROPERTY_CATEGORIES.map((category) => category.main);

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    bid_date: todayKst(),
    bid_year: String(new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear()),
    bid_case_no: '',
    item_no: '',
    court: '',
    client_name: '',
    bidder_name: '',
    property_main: '',
    property_type: '',
    suggested_price: '',
    actual_bid_price: '',
    winning_price: '',
    bid_result: '실패',
    deviation_reason: '',
  };
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('ko-KR');
}

function fmtCurrency(value: string) {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits).toLocaleString('ko-KR') : '';
}

function parseMoney(value: string) {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

function splitCaseNumber(caseNumber: string) {
  const match = String(caseNumber || '').match(/(\d{4})\s*타경\s*(\d+)/);
  if (!match) return { year: String(new Date().getFullYear()), no: caseNumber || '' };
  return { year: match[1], no: match[2] };
}

function resultClass(result: BidResult) {
  if (result === '낙찰') return 'won';
  if (result === '취소') return 'cancelled';
  return 'failed';
}

function findPropertyMain(propertyType: string) {
  return BID_PROPERTY_CATEGORIES.find((category) => (category.details as readonly string[]).includes(propertyType))?.main || '';
}

export default function FreelancerBidHistory() {
  const [rows, setRows] = useState<FreelancerBid[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const caseNumber = useMemo(() => {
    const no = form.bid_case_no.trim();
    return no ? `${form.bid_year}타경${no}` : '';
  }, [form.bid_year, form.bid_case_no]);
  const propertyDetailOptions = useMemo(() => (
    BID_PROPERTY_CATEGORIES.find((category) => category.main === form.property_main)?.details || []
  ), [form.property_main]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.freelancerBids.list();
      setRows(res.rows);
    } catch (err: any) {
      setError(err.message || '입찰 내역을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (key: keyof FormState, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm());
    setError('');
  };

  const edit = (row: FreelancerBid) => {
    const parsed = splitCaseNumber(row.case_number);
    setEditingId(row.id);
    setForm({
      bid_date: row.bid_date,
      bid_year: parsed.year,
      bid_case_no: parsed.no,
      item_no: row.item_no || '',
      court: row.court || '',
      client_name: row.client_name || '',
      bidder_name: row.bidder_name || '',
      property_main: findPropertyMain(row.property_type || ''),
      property_type: row.property_type || '',
      suggested_price: row.suggested_price ? row.suggested_price.toLocaleString('ko-KR') : '',
      actual_bid_price: row.actual_bid_price ? row.actual_bid_price.toLocaleString('ko-KR') : '',
      winning_price: row.winning_price ? row.winning_price.toLocaleString('ko-KR') : '',
      bid_result: row.bid_result || '실패',
      deviation_reason: row.deviation_reason || '',
    });
    setError('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.bid_date || !caseNumber || !form.client_name.trim() || !form.property_main || !form.property_type) {
      setError('입찰일, 사건번호, 고객명, 물건종류는 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bid_date: form.bid_date,
        court: form.court,
        case_number: caseNumber,
        item_no: form.item_no,
        client_name: form.client_name,
        bidder_name: form.bidder_name || form.client_name,
        property_type: form.property_type,
        suggested_price: parseMoney(form.suggested_price),
        actual_bid_price: parseMoney(form.actual_bid_price),
        winning_price: parseMoney(form.winning_price),
        bid_result: form.bid_result,
        deviation_reason: form.deviation_reason,
      };
      if (editingId) await api.freelancerBids.update(editingId, payload);
      else await api.freelancerBids.create(payload);
      reset();
      await load();
    } catch (err: any) {
      setError(err.message || '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: FreelancerBid) => {
    if (!window.confirm(`${row.case_number} 입찰 내역을 삭제할까요?`)) return;
    await api.freelancerBids.delete(row.id);
    if (editingId === row.id) reset();
    await load();
  };

  return (
    <div className="page-container freelancer-bid-page">
      <div className="page-header compact">
        <div>
          <h1>입찰 내역</h1>
          <p>프리랜서 전용 입찰 작성 내역입니다. 저장된 내용은 관리자 입찰분석에 자동 반영됩니다.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={reset}>
          <Plus size={16} /> 신규 작성
        </button>
      </div>

      <form className="freelancer-bid-form" onSubmit={save}>
        <div className="freelancer-bid-form-grid">
          <label>
            <span>입찰일 *</span>
            <input type="date" value={form.bid_date} onChange={(e) => setField('bid_date', e.target.value)} />
          </label>
          <label>
            <span>사건번호 *</span>
            <div className="case-no-inline">
              <select value={form.bid_year} onChange={(e) => setField('bid_year', e.target.value)}>
                {years.map(year => <option key={year} value={year}>{year}</option>)}
              </select>
              <span className="case-no-fixed">타경</span>
              <input value={form.bid_case_no} onChange={(e) => setField('bid_case_no', e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
          </label>
          <label>
            <span>물건번호</span>
            <input value={form.item_no} onChange={(e) => setField('item_no', e.target.value.replace(/[^0-9]/g, ''))} />
          </label>
          <label>
            <span>법원</span>
            <select value={form.court} onChange={(e) => setField('court', e.target.value)}>
              <option value="">선택</option>
              {COURT_OPTIONS.map(court => <option key={court.value} value={court.value}>{court.label}</option>)}
            </select>
          </label>
          <label>
            <span>고객명 *</span>
            <input value={form.client_name} onChange={(e) => setField('client_name', e.target.value)} />
          </label>
          <label>
            <span>입찰자명</span>
            <input value={form.bidder_name} onChange={(e) => setField('bidder_name', e.target.value)} placeholder={form.client_name || '미입력 시 고객명'} />
          </label>
          <label>
            <span>물건종류 대분류 *</span>
            <select
              value={form.property_main}
              onChange={(e) => setForm(prev => ({ ...prev, property_main: e.target.value, property_type: '' }))}
            >
              <option value="">선택</option>
              {propertyMainOptions.map(main => <option key={main} value={main}>{main}</option>)}
            </select>
          </label>
          <label>
            <span>물건종류 세부 *</span>
            <select
              value={form.property_type}
              onChange={(e) => setField('property_type', e.target.value)}
              disabled={!form.property_main}
            >
              <option value="">선택</option>
              {propertyDetailOptions.map(detail => <option key={detail} value={detail}>{detail}</option>)}
            </select>
          </label>
          <label>
            <span>제시입찰가</span>
            <input value={form.suggested_price} onChange={(e) => setField('suggested_price', fmtCurrency(e.target.value))} placeholder="0" />
          </label>
          <label>
            <span>작성입찰가</span>
            <input value={form.actual_bid_price} onChange={(e) => setField('actual_bid_price', fmtCurrency(e.target.value))} placeholder="0" />
          </label>
          <label>
            <span>낙찰가</span>
            <input value={form.winning_price} onChange={(e) => setField('winning_price', fmtCurrency(e.target.value))} placeholder="0" />
          </label>
          <label>
            <span>낙찰유무</span>
            <select value={form.bid_result} onChange={(e) => setField('bid_result', e.target.value as BidResult)}>
              <option value="실패">실패</option>
              <option value="낙찰">낙찰</option>
              <option value="취소">취소</option>
            </select>
          </label>
          <label className="freelancer-bid-wide">
            <span>사유</span>
            <textarea rows={2} value={form.deviation_reason} onChange={(e) => setField('deviation_reason', e.target.value)} />
          </label>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="freelancer-bid-actions">
          {editingId && <button type="button" className="btn-secondary" onClick={reset}><X size={16} /> 취소</button>}
          <button type="submit" className="btn-primary" disabled={saving}>
            <Save size={16} /> {saving ? '저장중' : editingId ? '수정 저장' : '저장'}
          </button>
        </div>
      </form>

      <div className="freelancer-bid-list">
        <div className="freelancer-bid-list-head">
          <h2>작성 내역</h2>
          <span>{rows.length.toLocaleString('ko-KR')}건</span>
        </div>
        {loading ? (
          <div className="empty-state">불러오는 중입니다.</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">작성된 입찰 내역이 없습니다.</div>
        ) : (
          <div className="freelancer-bid-table-wrap">
            <table className="freelancer-bid-table">
              <thead>
                <tr>
                  <th>입찰일</th>
                  <th>사건번호</th>
                  <th>고객명</th>
                  <th>물건종류</th>
                  <th>제시입찰가</th>
                  <th>작성입찰가</th>
                  <th>낙찰가</th>
                  <th>낙찰유무</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td>{row.bid_date}</td>
                    <td>
                      <strong>{row.case_number}</strong>
                      {row.item_no && <span className="subtle-text"> 물건 {row.item_no}</span>}
                    </td>
                    <td>{row.client_name}</td>
                    <td>{row.property_type || '-'}</td>
                    <td>{money(row.suggested_price)}</td>
                    <td>{money(row.actual_bid_price)}</td>
                    <td>{money(row.winning_price)}</td>
                    <td><span className={`bid-result-pill ${resultClass(row.bid_result)}`}>{row.bid_result}</span></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" onClick={() => edit(row)} title="수정"><Edit2 size={15} /></button>
                        <button type="button" onClick={() => remove(row)} title="삭제"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
