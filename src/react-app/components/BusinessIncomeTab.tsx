import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, RefreshCw, FileText, Users, X, Pencil, Download } from 'lucide-react';
import { api } from '../api';

type Entry = {
  id: string; user_id: string | null; name: string; ssn: string; address: string;
  amount: number; tax: number; net_amount: number;
  branch: string; department: string;
  is_ad_hoc: boolean; is_overridden: boolean; note: string;
};

type PoolItem = { id: string; name: string; ssn: string; address: string; note: string };

function fmt(n: number): string { return (n || 0).toLocaleString('ko-KR'); }
function parseMoney(s: string): number { return Number(String(s).replace(/[^0-9-]/g, '')) || 0; }

export default function BusinessIncomeTab({ month }: { month: string }) {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [poolMenuOpen, setPoolMenuOpen] = useState(false);
  const [poolManageOpen, setPoolManageOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.payroll.businessIncome(month);
      setEntries(res.entries || []);
      setDirty(new Set());
    } catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month]);

  const loadPool = async () => {
    try { const res = await api.payroll.businessIncomePool(); setPool(res.pool || []); }
    catch { /* ignore */ }
  };
  useEffect(() => { loadPool(); }, []);

  const updateEntry = (idx: number, patch: Partial<Entry>) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const next = { ...e, ...patch };
      // 금액 변경 시 세금·실지급 자동 계산
      if (patch.amount !== undefined) {
        next.tax = Math.round(next.amount * 0.033);
        next.net_amount = next.amount - next.tax;
      }
      return next;
    }));
    setDirty(prev => { const n = new Set(prev); n.add(String(idx)); return n; });
  };

  const addAdHoc = (seed?: { name: string; ssn: string; address: string }) => {
    const newEntry: Entry = {
      id: `new:${Date.now()}`,
      user_id: null, name: seed?.name || '', ssn: seed?.ssn || '', address: seed?.address || '',
      amount: 0, tax: 0, net_amount: 0,
      branch: '', department: '',
      is_ad_hoc: true, is_overridden: false, note: '',
    };
    setEntries(prev => [...prev, newEntry]);
    setDirty(prev => { const n = new Set(prev); n.add(String(entries.length)); return n; });
    setPoolMenuOpen(false);
  };

  const removeEntry = async (idx: number) => {
    const e = entries[idx];
    if (!confirm(`${e.name || '항목'}을 삭제하시겠습니까?`)) return;
    if (e.id && !e.id.startsWith('new:') && !e.id.startsWith('auto:')) {
      try { await api.payroll.deleteBusinessIncome(e.id); }
      catch (err: any) { alert(err.message); return; }
    }
    setEntries(prev => prev.filter((_, i) => i !== idx));
    setDirty(prev => { const n = new Set(prev); n.delete(String(idx)); return n; });
  };

  const saveAll = async () => {
    if (dirty.size === 0) { alert('변경된 항목이 없습니다.'); return; }
    setSaving(true);
    try {
      for (const idxStr of Array.from(dirty)) {
        const idx = Number(idxStr);
        const e = entries[idx]; if (!e) continue;
        if (!e.name.trim()) continue;
        await api.payroll.saveBusinessIncome({
          month, id: e.id.startsWith('new:') ? undefined : e.id.startsWith('auto:') ? undefined : e.id,
          user_id: e.is_ad_hoc ? null : e.user_id,
          name: e.name.trim(), ssn: e.ssn.trim(), address: e.address.trim(),
          amount: e.amount, tax: e.tax, net_amount: e.net_amount,
          is_ad_hoc: e.is_ad_hoc, note: e.note,
        });
      }
      await load();
      alert('저장되었습니다.');
    } catch (err: any) { alert('저장 실패: ' + err.message); }
    finally { setSaving(false); }
  };

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({
        amount: acc.amount + (e.amount || 0),
        tax: acc.tax + (e.tax || 0),
        net: acc.net + (e.net_amount || 0),
      }),
      { amount: 0, tax: 0, net: 0 }
    );
  }, [entries]);

  const entryStatusLabel = (entry: Entry): string => {
    if (entry.is_ad_hoc) return '임시';
    if (entry.is_overridden) return '수정';
    return '자동';
  };

  const exportExcel = async () => {
    if (entries.length === 0) { alert('다운로드할 데이터가 없습니다.'); return; }

    const XLSX = await import('xlsx');
    const yy = month.split('-')[0];
    const mm = Number(month.split('-')[1]);
    const rows = entries.map((e, i) => [
      i + 1,
      e.name,
      e.branch,
      e.department,
      e.ssn,
      e.address,
      e.amount || 0,
      e.tax || 0,
      e.net_amount || 0,
      entryStatusLabel(e),
      e.note || '',
    ]);

    const sheetData = [
      ['사업소득 지급명세서'],
      [`기준월: ${yy}년 ${mm}월`, `작성일: ${new Date().toISOString().slice(0, 10)}`, `인원: ${entries.length}명`],
      [],
      ['No', '이름', '지점', '부서', '주민등록번호', '주소', '지급액', '원천징수세액(3.3%)', '실지급액', '상태', '비고'],
      ...rows,
      [],
      ['합계', '', '', '', '', '', totals.amount, totals.tax, totals.net, '', ''],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
      { wch: 42 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 24 },
    ];

    const moneyFormat = '#,##0';
    const firstDataRow = 5;
    const lastDataRow = firstDataRow + rows.length - 1;
    for (let r = firstDataRow; r <= lastDataRow; r += 1) {
      ['G', 'H', 'I'].forEach((col) => {
        const cell = ws[`${col}${r}`];
        if (cell) cell.z = moneyFormat;
      });
    }
    const totalRow = firstDataRow + rows.length + 1;
    ['G', 'H', 'I'].forEach((col) => {
      const cell = ws[`${col}${totalRow}`];
      if (cell) cell.z = moneyFormat;
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '사업소득신고');
    XLSX.writeFile(wb, `사업소득신고_${month}.xlsx`);
  };

  // PDF 저장 — 깔끔한 인쇄용 레이아웃으로 생성
  const exportPdf = async () => {
    if (entries.length === 0) { alert('출력할 데이터가 없습니다.'); return; }
    const html2pdf = (await import('html2pdf.js' as any)).default;
    const container = document.createElement('div');
    container.style.cssText = 'padding:16mm 12mm;font-family:"Malgun Gothic","맑은 고딕",sans-serif;color:#000;background:#fff;';

    const yy = month.split('-')[0];
    const mm = Number(month.split('-')[1]);
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const rows = entries.map((e, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${esc(e.name)}</td>
        <td style="font-family:'SF Mono',monospace;font-size:10px;">${esc(e.ssn)}</td>
        <td style="font-size:10px;">${esc(e.address)}</td>
        <td style="text-align:right;">${fmt(e.amount)}</td>
        <td style="text-align:right;">${fmt(e.tax)}</td>
        <td style="text-align:right;">${fmt(e.net_amount)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <h1 style="text-align:center;font-size:20pt;margin:0 0 6px;letter-spacing:-0.5px;">사업소득 지급명세서</h1>
      <h2 style="text-align:center;font-size:13pt;margin:0 0 20px;color:#555;font-weight:500;">${yy}년 ${mm}월</h2>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:10pt;">
        <span>지급자: 마이옥션(주)</span>
        <span>작성일: ${new Date().toISOString().slice(0, 10)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10pt;border:1.5px solid #000;">
        <thead>
          <tr style="background:#e8e8e8;font-weight:700;">
            <th style="border:1px solid #000;padding:6px 4px;width:32px;">No</th>
            <th style="border:1px solid #000;padding:6px 4px;width:70px;">이름</th>
            <th style="border:1px solid #000;padding:6px 4px;width:100px;">주민등록번호</th>
            <th style="border:1px solid #000;padding:6px 4px;">주소</th>
            <th style="border:1px solid #000;padding:6px 4px;width:80px;">금액</th>
            <th style="border:1px solid #000;padding:6px 4px;width:80px;">갑근세(3.3%)</th>
            <th style="border:1px solid #000;padding:6px 4px;width:80px;">실지급액</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:#f4f4f4;font-weight:700;">
            <td colspan="4" style="border:1px solid #000;padding:8px 10px;text-align:right;">합계</td>
            <td style="border:1px solid #000;padding:8px 6px;text-align:right;">${fmt(totals.amount)}</td>
            <td style="border:1px solid #000;padding:8px 6px;text-align:right;">${fmt(totals.tax)}</td>
            <td style="border:1px solid #000;padding:8px 6px;text-align:right;">${fmt(totals.net)}</td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:20px;font-size:9pt;color:#666;">
        · 상기 금액은 ${yy}년 ${mm}월 기준 ${entries.length}명의 사업소득 지급 내역입니다.<br/>
        · 갑근세는 3.3% 원천징수 기준이며, 실지급액은 세전금액에서 원천징수세를 공제한 금액입니다.
      </div>
    `;

    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '297mm';
    container.style.zIndex = '1';
    document.body.appendChild(container);

    try {
      await (html2pdf().set as any)({
        margin: [8, 8, 8, 8],
        filename: `사업소득신고_${month}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(container).save();
    } finally {
      container.remove();
    }
  };

  return (
    <div className="business-income-tab">
      <div className="bi-head">
        <div className="bi-head-info">
          <FileText size={16} color="#7b1fa2" />
          <strong>{month}</strong> 사업소득신고 (비율제 대상)
          <span className="bi-head-count">{entries.length}명</span>
        </div>
        <div className="bi-head-actions">
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'drive-spin' : ''} /> 새로고침
          </button>
          <button className="btn btn-sm" onClick={exportPdf} disabled={loading || entries.length === 0} title="세무사 제출용 PDF 다운로드">
            <Download size={13} /> PDF 저장
          </button>
          <button className="btn btn-sm" onClick={exportExcel} disabled={loading || entries.length === 0} title="월별 사업소득신고 엑셀 다운로드">
            <Download size={13} /> 엑셀 저장
          </button>
          <div className="bi-addmenu-wrap">
            <button className="btn btn-sm" onClick={() => setPoolMenuOpen(v => !v)}>
              <Plus size={13} /> 인원 추가 ▾
            </button>
            {poolMenuOpen && (
              <>
                <div className="bi-addmenu-backdrop" onClick={() => setPoolMenuOpen(false)} />
                <div className="bi-addmenu">
                  <div className="bi-addmenu-head">
                    <Users size={12} /> 추가 리스트에서 선택 ({pool.length}명)
                  </div>
                  <div className="bi-addmenu-list">
                    {pool.length === 0 ? (
                      <div className="bi-addmenu-empty">풀이 비어있습니다. [풀 관리]에서 추가하세요.</div>
                    ) : pool.map(p => (
                      <button key={p.id} className="bi-addmenu-item"
                        onClick={() => addAdHoc({ name: p.name, ssn: p.ssn, address: p.address })}>
                        <div className="bi-addmenu-name">{p.name}</div>
                        <div className="bi-addmenu-sub">{p.ssn || '-'} · {p.address.slice(0, 30) || '주소 없음'}{p.address.length > 30 ? '…' : ''}</div>
                      </button>
                    ))}
                  </div>
                  <div className="bi-addmenu-foot">
                    <button className="btn btn-sm" onClick={() => addAdHoc()}><Plus size={12} /> 빈 항목 추가</button>
                    <button className="btn btn-sm" onClick={() => { setPoolMenuOpen(false); setPoolManageOpen(true); }}>
                      <Pencil size={12} /> 풀 관리
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <button className="btn btn-sm btn-primary" onClick={saveAll} disabled={saving || dirty.size === 0}>
            <Save size={13} /> 저장 {dirty.size > 0 && `(${dirty.size})`}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bi-empty">로딩중...</div>
      ) : entries.length === 0 ? (
        <div className="bi-empty">비율제 대상자가 없습니다.</div>
      ) : (
        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>이름</th>
                <th style={{ width: 120 }}>소속</th>
                <th style={{ width: 140 }}>주민번호</th>
                <th>주소</th>
                <th style={{ width: 130, textAlign: 'right' }}>금액</th>
                <th style={{ width: 110, textAlign: 'right' }}>갑근세 3.3%</th>
                <th style={{ width: 130, textAlign: 'right' }}>실지급액</th>
                <th style={{ width: 90, textAlign: 'center' }}>상태</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => (
                <tr key={e.id} className={e.is_ad_hoc ? 'ad-hoc' : e.is_overridden ? 'overridden' : ''}>
                  <td>
                    <input className="bi-input" value={e.name}
                      onChange={(ev) => updateEntry(idx, { name: ev.target.value })} />
                  </td>
                  <td className="bi-compact">
                    {e.is_ad_hoc ? (
                      <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>임시추가</span>
                    ) : (
                      <span style={{ fontSize: '0.75rem' }}>{e.branch}{e.department ? ' · ' + e.department : ''}</span>
                    )}
                  </td>
                  <td>
                    <input className="bi-input" value={e.ssn}
                      placeholder="000000-0000000"
                      onChange={(ev) => updateEntry(idx, { ssn: ev.target.value })} />
                  </td>
                  <td>
                    <input className="bi-input" value={e.address}
                      placeholder="주소"
                      onChange={(ev) => updateEntry(idx, { address: ev.target.value })} />
                  </td>
                  <td>
                    <input className="bi-input bi-num" value={fmt(e.amount)}
                      onChange={(ev) => updateEntry(idx, { amount: parseMoney(ev.target.value) })} />
                  </td>
                  <td>
                    <input className="bi-input bi-num" value={fmt(e.tax)}
                      onChange={(ev) => updateEntry(idx, { tax: parseMoney(ev.target.value), net_amount: e.amount - parseMoney(ev.target.value) })} />
                  </td>
                  <td>
                    <input className="bi-input bi-num" value={fmt(e.net_amount)}
                      onChange={(ev) => updateEntry(idx, { net_amount: parseMoney(ev.target.value) })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {e.is_ad_hoc ? <span className="bi-badge ad">임시</span>
                      : e.is_overridden ? <span className="bi-badge ov">수정</span>
                      : <span className="bi-badge auto">자동</span>}
                  </td>
                  <td>
                    <button className="bi-delete-btn" onClick={() => removeEntry(idx)} title="삭제"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bi-total">
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>합계</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.amount)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.tax)}원</td>
                <td style={{ textAlign: 'right' }}>{fmt(totals.net)}원</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="bi-note">
        · 금액 입력 시 갑근세(3.3%) 및 실지급액이 자동 계산됩니다 (개별 수정 가능).<br/>
        · 자동 = 매출 기반 자동 산정 / 수정 = 총무 임의 수정본 / 임시 = 임시 추가 인원.<br/>
        · [인원 추가] 드롭다운에서 풀(추가 리스트) 중 선택 또는 빈 항목 추가.<br/>
        · 세무사 제출용 리스트로 활용하세요.
      </div>

      {poolManageOpen && (
        <PoolManageModal
          pool={pool}
          onClose={() => setPoolManageOpen(false)}
          onChange={loadPool}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// 풀 관리 모달 (추가 리스트 CRUD)
// ═══════════════════════════════════════
function PoolManageModal({ pool, onClose, onChange }: { pool: PoolItem[]; onClose: () => void; onChange: () => void }) {
  const [items, setItems] = useState<PoolItem[]>(pool);
  const [newName, setNewName] = useState('');
  const [newSsn, setNewSsn] = useState('');
  const [newAddress, setNewAddress] = useState('');

  useEffect(() => { setItems(pool); }, [pool]);

  const addItem = async () => {
    if (!newName.trim()) return alert('이름을 입력하세요.');
    try {
      await api.payroll.addBusinessIncomePool({ name: newName.trim(), ssn: newSsn.trim(), address: newAddress.trim() });
      setNewName(''); setNewSsn(''); setNewAddress('');
      await onChange();
    } catch (err: any) { alert(err.message); }
  };
  const updateItem = async (id: string, patch: Partial<PoolItem>) => {
    const item = items.find(i => i.id === id); if (!item) return;
    const next = { ...item, ...patch };
    setItems(prev => prev.map(i => i.id === id ? next : i));
    try { await api.payroll.updateBusinessIncomePool(id, { name: next.name, ssn: next.ssn, address: next.address, note: next.note }); }
    catch (err: any) { alert(err.message); }
  };
  const deleteItem = async (id: string, name: string) => {
    if (!confirm(`${name}을(를) 풀에서 삭제하시겠습니까?`)) return;
    try { await api.payroll.deleteBusinessIncomePool(id); await onChange(); }
    catch (err: any) { alert(err.message); }
  };

  return (
    <div className="drive-modal-backdrop" onClick={onClose}>
      <div className="drive-modal" style={{ width: 'min(800px, 96vw)', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="drive-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} color="#7b1fa2" />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>사업소득신고 추가 리스트 관리 ({items.length}명)</h3>
          </div>
          <button className="drive-close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="drive-modal-body">
          <div className="bi-pool-add">
            <input className="form-input" placeholder="이름" value={newName} onChange={e => setNewName(e.target.value)} style={{ flex: '0 0 110px' }} />
            <input className="form-input" placeholder="주민번호" value={newSsn} onChange={e => setNewSsn(e.target.value)} style={{ flex: '0 0 150px' }} />
            <input className="form-input" placeholder="주소" value={newAddress} onChange={e => setNewAddress(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" onClick={addItem}><Plus size={12} /> 추가</button>
          </div>

          <div className="bi-table-wrap" style={{ maxHeight: 420 }}>
            <table className="bi-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>이름</th>
                  <th style={{ width: 150 }}>주민번호</th>
                  <th>주소</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: '#9aa0a6', padding: 20 }}>풀이 비어있습니다.</td></tr>
                ) : items.map(it => (
                  <tr key={it.id}>
                    <td><input className="bi-input" value={it.name} onChange={e => updateItem(it.id, { name: e.target.value })} /></td>
                    <td><input className="bi-input" value={it.ssn} onChange={e => updateItem(it.id, { ssn: e.target.value })} /></td>
                    <td><input className="bi-input" value={it.address} onChange={e => updateItem(it.id, { address: e.target.value })} /></td>
                    <td><button className="bi-delete-btn" onClick={() => deleteItem(it.id, it.name)}><Trash2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bi-note" style={{ marginTop: 12 }}>
            · 셀 클릭으로 바로 수정 (자동 저장).<br/>
            · 여기 등록된 인원은 [인원 추가] 드롭다운에서 언제든 선택 가능.
          </div>
        </div>
      </div>
    </div>
  );
}
