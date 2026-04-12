import { useEffect, useState } from 'react';
import { api } from '../api';
import { Plus, Pencil, Trash2, GripVertical, Building2 } from 'lucide-react';

interface Dept {
  id: string;
  name: string;
  branch: string;
  sort_order: number;
}

interface Branch {
  id: string;
  name: string;
  sort_order: number;
}

export default function TeamList() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [branchList, setBranchList] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api.departments.list(), api.branches.list()])
      .then(([dRes, bRes]) => { setDepts(dRes.departments); setBranchList(bRes.branches); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) { alert('팀 이름을 입력하세요.'); return; }
    try {
      await api.departments.create(newName.trim());
      setNewName('');
      load();
    } catch (err: any) { alert(err.message); }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    await api.departments.update(id, { name: editName.trim() });
    setEditId(null);
    load();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 팀을 삭제하시겠습니까?\n해당 팀 소속 인원의 팀 정보가 유지됩니다.`)) return;
    await api.departments.delete(id);
    load();
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) { alert('지사명을 입력하세요.'); return; }
    try { await api.branches.create(newBranchName.trim()); setNewBranchName(''); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleDeleteBranch = async (id: string, name: string) => {
    if (!confirm(`"${name}" 지사를 삭제하시겠습니까?`)) return;
    try { await api.branches.delete(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>팀 관리</h2>
      </div>

      {/* 지사 관리 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={18} /> 지사 관리
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {branchList.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f1f3f4', borderRadius: 8, fontSize: '0.85rem' }}>
              <strong>{b.name}</strong>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bdc1c6', padding: 0 }}
                onClick={() => handleDeleteBranch(b.id, b.name)}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#d93025')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#bdc1c6')}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="새 지사명" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #dadce0', fontSize: '0.85rem', width: 160 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()} />
          <button className="btn btn-sm btn-primary" onClick={handleCreateBranch}><Plus size={14} /> 추가</button>
        </div>
      </div>

      {/* 팀 추가 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="form-row form-row-inline" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label>새 팀 추가</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="팀 이름 (예: 경매사업부4팀, 법무팀)"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <button className="btn btn-primary" onClick={handleCreate} style={{ marginBottom: 0, height: 40 }}>
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      {/* 팀 목록 */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '5%' }}>#</th>
              <th>팀 이름</th>
              <th style={{ width: '15%' }}>소속 인원</th>
              <th style={{ width: '15%' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {depts.map((d, i) => (
              <tr key={d.id}>
                <td style={{ textAlign: 'center', color: '#9aa0a6' }}>
                  <GripVertical size={14} style={{ verticalAlign: 'middle' }} /> {i + 1}
                </td>
                <td>
                  {editId === d.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(d.id)}
                        style={{ padding: '4px 8px', border: '1.5px solid #1a73e8', borderRadius: 6, fontSize: '0.85rem', flex: 1 }}
                        autoFocus
                      />
                      <button className="btn btn-sm btn-primary" onClick={() => handleUpdate(d.id)}>저장</button>
                      <button className="btn btn-sm" onClick={() => setEditId(null)}>취소</button>
                    </div>
                  ) : (
                    <strong>{d.name}</strong>
                  )}
                </td>
                <td style={{ textAlign: 'center', color: '#9aa0a6' }}>-</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => { setEditId(d.id); setEditName(d.name); }}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(d.id, d.name)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {depts.length === 0 && (
              <tr><td colSpan={4} className="empty-state">등록된 팀이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
