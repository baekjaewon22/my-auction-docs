import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Team, User } from '../types';

export default function TeamList() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const load = async () => {
    setLoading(true);
    const [teamRes, userRes] = await Promise.all([api.teams.list(), api.users.list()]);
    setTeams(teamRes.teams);
    setAllUsers(userRes.users);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadMembers = async (teamId: string) => {
    setSelectedTeam(teamId);
    const res = await api.teams.members(teamId);
    setMembers(res.members);
  };

  const handleCreate = async () => {
    if (!newName) return;
    await api.teams.create(newName, newDesc);
    setShowCreate(false);
    setNewName('');
    setNewDesc('');
    load();
  };

  const handleUpdate = async (id: string) => {
    await api.teams.update(id, { name: editName, description: editDesc });
    setShowEdit(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('팀을 삭제하시겠습니까? 팀원들은 소속 없음 상태가 됩니다.')) return;
    await api.teams.delete(id);
    if (selectedTeam === id) setSelectedTeam(null);
    load();
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedTeam) return;
    await api.teams.addMember(selectedTeam, userId);
    loadMembers(selectedTeam);
    load();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedTeam) return;
    await api.teams.removeMember(selectedTeam, userId);
    loadMembers(selectedTeam);
    load();
  };

  const startEdit = (team: Team) => {
    setShowEdit(team.id);
    setEditName(team.name);
    setEditDesc(team.description);
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  const unassignedUsers = allUsers.filter((u) => !u.team_id);

  return (
    <div className="page">
      <div className="page-header">
        <h2>팀 관리</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 새 팀</button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h4>새 팀 만들기</h4>
          <div className="form-row">
            <div className="form-group">
              <label>팀 이름</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="팀 이름" />
            </div>
            <div className="form-group">
              <label>설명</label>
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="팀 설명" />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setShowCreate(false)}>취소</button>
            <button className="btn btn-primary" onClick={handleCreate}>생성</button>
          </div>
        </div>
      )}

      <div className="team-layout">
        <div className="team-list-panel">
          {teams.map((team) => (
            <div
              key={team.id}
              className={`team-card ${selectedTeam === team.id ? 'active' : ''}`}
              onClick={() => loadMembers(team.id)}
            >
              {showEdit === team.id ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="inline-input" />
                  <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="inline-input" style={{ marginTop: 4 }} />
                  <div className="form-actions" style={{ marginTop: 4 }}>
                    <button className="btn btn-sm" onClick={() => setShowEdit(null)}>취소</button>
                    <button className="btn btn-sm btn-primary" onClick={() => handleUpdate(team.id)}>저장</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="team-name">{team.name}</div>
                  <div className="team-desc">{team.description}</div>
                  <div className="team-actions">
                    <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); startEdit(team); }}>편집</button>
                    <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleDelete(team.id); }}>삭제</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {teams.length === 0 && <div className="empty-state">팀이 없습니다.</div>}
        </div>

        {selectedTeam && (
          <div className="team-members-panel">
            <h4>팀원 목록</h4>
            <div className="member-list">
              {members.map((m) => (
                <div key={m.id} className="member-item">
                  <div>
                    <span className="member-name">{m.name}</span>
                    <span className="member-role">
                      {m.role === 'admin' ? '관리자' : m.role === 'manager' ? '팀장' : '팀원'}
                    </span>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={() => handleRemoveMember(m.id)}>제거</button>
                </div>
              ))}
              {members.length === 0 && <div className="empty-state">팀원이 없습니다.</div>}
            </div>

            {unassignedUsers.length > 0 && (
              <>
                <h4 style={{ marginTop: '1rem' }}>미배정 사용자</h4>
                <div className="member-list">
                  {unassignedUsers.map((u) => (
                    <div key={u.id} className="member-item">
                      <span className="member-name">{u.name} ({u.email})</span>
                      <button className="btn btn-sm btn-primary" onClick={() => handleAddMember(u.id)}>추가</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
