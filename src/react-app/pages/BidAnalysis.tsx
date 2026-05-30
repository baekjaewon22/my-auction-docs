import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Edit2, Plus, Save, Search, Upload, X } from 'lucide-react';
import { api } from '../api';

type BidResult = '실패' | '낙찰' | '취소' | '취하/변경';

type BidAnalysisRow = {
  id: string;
  bid_datetime: string;
  assignee_name: string;
  branch_name?: string;
  case_number: string;
  property_type: string;
  suggested_bid_price: number | null;
  actual_bid_price: number | null;
  winning_price: number | null;
  is_won: number;
  bid_result?: BidResult;
  client_name: string;
  source_type?: string;
  manual_override?: number;
};

type BidAnalysisForm = {
  bid_datetime: string;
  assignee_name: string;
  branch_name: string;
  case_number: string;
  property_type: string;
  suggested_bid_price: string;
  actual_bid_price: string;
  winning_price: string;
  bid_result: BidResult;
  client_name: string;
};

const PAGE_SIZE = 20;
const PAGE_WINDOW = 10;

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('ko-KR');
}

function readCell(row: Record<string, unknown>, names: string[]) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/\s/g, ''), value]));
  for (const name of names) {
    const value = normalized[name.replace(/\s/g, '')];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function parseAmount(value: unknown) {
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseBidResult(value: unknown): BidResult {
  const text = String(value ?? '').trim().toLowerCase();
  if (['취하', '변경', '취하/변경'].includes(text)) return '취하/변경';
  if (['취소', 'cancel', 'cancelled'].includes(text)) return '취소';
  if (['1', 'y', 'yes', 'o', 'true', '낙찰', '성공'].includes(text)) return '낙찰';
  return '실패';
}

function parseExcelDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 16).replace('T', ' ');
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) {
    const [, y, m, d, hh = '00', mm = '00'] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${hh.padStart(2, '0')}:${mm}`;
  }
  return text;
}

function formatBidDate(value: string) {
  return String(value || '').slice(0, 10) || '-';
}

function resultClass(result?: string) {
  if (result === '낙찰') return 'won';
  if (result === '취소' || result === '취하/변경') return 'cancelled';
  return 'failed';
}

function sourceLabel(source?: string) {
  if (source === 'journal') return '일지';
  if (source === 'freelancer') return '프리랜서';
  if (source === 'manual') return '수기';
  return '엑셀';
}

function amountToInput(value: number | null | undefined) {
  return value ? Number(value).toLocaleString('ko-KR') : '';
}

function emptyForm(): BidAnalysisForm {
  return {
    bid_datetime: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
    assignee_name: '',
    branch_name: '',
    case_number: '',
    property_type: '',
    suggested_bid_price: '',
    actual_bid_price: '',
    winning_price: '',
    bid_result: '실패',
    client_name: '',
  };
}

export default function BidAnalysis() {
  const [rows, setRows] = useState<BidAnalysisRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branch, setBranch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BidAnalysisForm>(() => emptyForm());

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageGroup = Math.floor((page - 1) / PAGE_WINDOW);
  const visiblePages = useMemo(() => {
    const start = pageGroup * PAGE_WINDOW + 1;
    const end = Math.min(totalPages, start + PAGE_WINDOW - 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [pageGroup, totalPages]);
  const hasPrevPageGroup = pageGroup > 0;
  const hasNextPageGroup = visiblePages[visiblePages.length - 1] < totalPages;

  const load = async (nextPage = page) => {
    setLoading(true);
    try {
      const res = await api.adminNotes.bidAnalysisList({ from, to, branch, assignee, page: nextPage, page_size: PAGE_SIZE });
      setRows(res.rows);
      setTotal(res.total);
      setPage(res.page);
      setBranches(res.filters?.branches || []);
      setAssignees(res.filters?.assignees || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1).catch(() => undefined);
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const parsed = rawRows.map(row => ({
        bid_datetime: parseExcelDate(readCell(row, ['입찰일시', '입찰일', '입찰일자', '일시'])),
        assignee_name: String(readCell(row, ['담당자', '담당자명'])).trim(),
        branch_name: String(readCell(row, ['지사', '지점', '소속'])).trim(),
        case_number: String(readCell(row, ['사건번호', '사건 번호'])).trim(),
        property_type: String(readCell(row, ['물건종류', '물건 종류', '종류'])).trim(),
        suggested_bid_price: parseAmount(readCell(row, ['예상낙찰가', '예상 낙찰가', '제시입찰가', '제시 입찰가'])),
        actual_bid_price: parseAmount(readCell(row, ['입찰가', '실제입찰가', '실제 입찰가'])),
        winning_price: parseAmount(readCell(row, ['낙찰가'])),
        bid_result: parseBidResult(readCell(row, ['낙찰유무', '낙찰 여부', '낙찰'])),
        client_name: String(readCell(row, ['고객명', '계약자명', '의뢰인'])).trim(),
      })).filter(row => row.bid_datetime);

      if (parsed.length === 0) {
        alert('업로드할 수 있는 입찰분석 행을 찾지 못했습니다.');
        return;
      }
      const res = await api.adminNotes.bidAnalysisUpload(parsed, file.name);
      alert(`${res.inserted}건 업로드되었습니다.`);
      await load(1);
    } catch (err) {
      alert(err instanceof Error ? err.message : '엑셀 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const setFormField = (key: keyof BidAnalysisForm, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const startEdit = (row: BidAnalysisRow) => {
    setEditingId(row.id);
    setFormOpen(true);
    setForm({
      bid_datetime: formatBidDate(row.bid_datetime),
      assignee_name: row.assignee_name || '',
      branch_name: row.branch_name || '',
      case_number: row.case_number || '',
      property_type: row.property_type || '',
      suggested_bid_price: amountToInput(row.suggested_bid_price),
      actual_bid_price: amountToInput(row.actual_bid_price),
      winning_price: amountToInput(row.winning_price),
      bid_result: row.bid_result || (row.is_won ? '낙찰' : '실패'),
      client_name: row.client_name || '',
    });
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const saveManual = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.bid_datetime || !form.case_number) {
      alert('입찰일과 사건번호는 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        suggested_bid_price: parseAmount(form.suggested_bid_price),
        actual_bid_price: parseAmount(form.actual_bid_price),
        winning_price: parseAmount(form.winning_price),
      };
      if (editingId) await api.adminNotes.bidAnalysisUpdate(editingId, payload);
      else await api.adminNotes.bidAnalysisCreate(payload);
      closeForm();
      await load(editingId ? page : 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const moveNextGroup = () => {
    if (!hasNextPageGroup) return;
    load(pageGroup * PAGE_WINDOW + PAGE_WINDOW + 1);
  };

  const movePrevGroup = () => {
    if (!hasPrevPageGroup) return;
    load((pageGroup - 1) * PAGE_WINDOW + 1);
  };

  return (
    <div className="bid-analysis">
      <div className="bid-analysis-toolbar">
        <div className="bid-analysis-field">
          <label>시작일</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="bid-analysis-field">
          <label>종료일</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="bid-analysis-field">
          <label>지사</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">전체</option>
            {branches.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="bid-analysis-field">
          <label>담당자</label>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">전체</option>
            {assignees.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <button className="btn btn-primary bid-analysis-action" onClick={() => load(1)} disabled={loading}>
          <Search size={14} /> 조회
        </button>
        <label className="btn bid-analysis-action">
          <Upload size={14} /> {uploading ? '업로드 중...' : '엑셀 첨부'}
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
        </label>
        <button className="btn btn-secondary bid-analysis-action" onClick={startCreate} type="button">
          <Plus size={14} /> 수기 입력
        </button>
      </div>

      {formOpen && (
        <form className="bid-analysis-manual-form" onSubmit={saveManual}>
          <div className="bid-analysis-manual-head">
            <strong>{editingId ? '입찰분석 수정' : '입찰분석 수기 입력'}</strong>
            <button type="button" onClick={closeForm} aria-label="닫기"><X size={16} /></button>
          </div>
          <div className="bid-analysis-manual-grid">
            <label><span>입찰일</span><input type="date" value={form.bid_datetime} onChange={(e) => setFormField('bid_datetime', e.target.value)} /></label>
            <label><span>지사</span><input value={form.branch_name} onChange={(e) => setFormField('branch_name', e.target.value)} /></label>
            <label><span>담당자</span><input value={form.assignee_name} onChange={(e) => setFormField('assignee_name', e.target.value)} /></label>
            <label><span>사건번호</span><input value={form.case_number} onChange={(e) => setFormField('case_number', e.target.value)} /></label>
            <label><span>물건종류</span><input value={form.property_type} onChange={(e) => setFormField('property_type', e.target.value)} /></label>
            <label><span>고객명</span><input value={form.client_name} onChange={(e) => setFormField('client_name', e.target.value)} /></label>
            <label><span>예상낙찰가</span><input value={form.suggested_bid_price} onChange={(e) => setFormField('suggested_bid_price', e.target.value)} /></label>
            <label><span>입찰가</span><input value={form.actual_bid_price} onChange={(e) => setFormField('actual_bid_price', e.target.value)} /></label>
            <label><span>낙찰가</span><input value={form.winning_price} onChange={(e) => setFormField('winning_price', e.target.value)} /></label>
            <label><span>낙찰유무</span><select value={form.bid_result} onChange={(e) => setFormField('bid_result', e.target.value as BidResult)}><option value="실패">실패</option><option value="낙찰">낙찰</option><option value="취소">취소</option><option value="취하/변경">취하/변경</option></select></label>
          </div>
          <div className="bid-analysis-manual-actions">
            <button type="button" className="btn btn-secondary" onClick={closeForm}><X size={14} /> 취소</button>
            <button type="submit" className="btn btn-primary" disabled={saving}><Save size={14} /> {saving ? '저장 중' : '저장'}</button>
          </div>
        </form>
      )}

      <div className="bid-analysis-table-wrap">
        <table className="bid-analysis-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>입찰일시</th>
              <th>지사/담당자</th>
              <th>사건번호</th>
              <th>물건종류</th>
              <th>예상낙찰가</th>
              <th>입찰가</th>
              <th>낙찰가</th>
              <th>낙찰유무</th>
              <th>고객명</th>
              <th>출처</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const result = row.bid_result || (row.is_won ? '낙찰' : '실패');
              return (
                <tr key={row.id}>
                  <td className="bid-analysis-no">{(page - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="bid-analysis-date">{formatBidDate(row.bid_datetime)}</td>
                  <td className="bid-analysis-person">
                    <span>{row.branch_name || '-'}</span>
                    <strong>{row.assignee_name || '-'}</strong>
                  </td>
                  <td className="bid-analysis-case">{row.case_number || '-'}</td>
                  <td>{row.property_type || '-'}</td>
                  <td className="bid-analysis-money">{money(row.suggested_bid_price)}</td>
                  <td className="bid-analysis-money">{money(row.actual_bid_price)}</td>
                  <td className="bid-analysis-money">{money(row.winning_price)}</td>
                  <td><span className={`bid-result-pill ${resultClass(result)}`}>{result}</span></td>
                  <td>{row.client_name || '-'}</td>
                  <td><span className="bid-analysis-source">{sourceLabel(row.source_type)}{row.manual_override ? ' · 수정' : ''}</span></td>
                  <td><button type="button" className="bid-analysis-edit-btn" onClick={() => startEdit(row)} title="수정"><Edit2 size={14} /></button></td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={12} className="empty-state">등록된 입찰분석 내역이 없습니다.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={12} className="empty-state">불러오는 중...</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bid-analysis-footer">
        <span>총 {total.toLocaleString('ko-KR')}건</span>
        <div className="bid-analysis-pages">
          {hasPrevPageGroup && (
            <button className="prev-group" onClick={movePrevGroup} disabled={loading} aria-label="이전 페이지 더보기">
              <ChevronLeft size={16} />
            </button>
          )}
          {visiblePages.map(num => (
            <button key={num} className={page === num ? 'active' : ''} onClick={() => load(num)} disabled={loading}>
              {num}
            </button>
          ))}
          {hasNextPageGroup && (
            <button className="next-group" onClick={moveNextGroup} disabled={loading} aria-label="다음 페이지 더보기">
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
