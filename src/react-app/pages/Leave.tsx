import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { LeaveRequest, User } from '../types';
import Select from '../components/Select';
import {
  CalendarCheck, Plus, X, CheckCircle, XCircle, AlertTriangle,
  Calculator, Calendar, FileText, ExternalLink, Eye
} from 'lucide-react';

type FormLeaveType = '연차/월차' | '반차' | '시간차' | '특별휴가';

const FORM_LEAVE_TYPES: { value: FormLeaveType; label: string; desc: string; color: string }[] = [
  { value: '연차/월차', label: '연차/월차', desc: '1일 단위 사용', color: '#1a73e8' },
  { value: '반차', label: '반차', desc: '0.5일 차감', color: '#e65100' },
  { value: '시간차', label: '시간차', desc: '시간 단위 사용', color: '#9aa0a6' },
  { value: '특별휴가', label: '특별휴가', desc: '경조사 등', color: '#7b1fa2' },
];

// 특별휴가 세부 유형
type SpecialLeaveSubtype = '특별유급휴가' | '기타';

const SPECIAL_LEAVE_ITEMS = [
  { label: '본인 결혼', days: 5 },
  { label: '부모/배우자부모/배우자/자녀 장례', days: 3 },
  { label: '조부모/배우자조부모/형제자매 장례', days: 1 },
];

// 타입 색상 매핑 (목록 표시용)
function getTypeColor(leaveType: string): string {
  if (leaveType === '연차' || leaveType === '월차') return '#1a73e8';
  if (leaveType === '반차') return '#e65100';
  if (leaveType === '특별휴가') return '#7b1fa2';
  if (leaveType === '시간차') return '#9aa0a6';
  return '#5f6368';
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '승인대기', color: '#e65100', bg: '#fff3e0' },
  approved: { label: '승인완료', color: '#188038', bg: '#e8f5e9' },
  rejected: { label: '반려', color: '#d93025', bg: '#fce4ec' },
  cancelled: { label: '취소', color: '#9aa0a6', bg: '#f5f5f5' },
  cancel_requested: { label: '취소요청', color: '#d93025', bg: '#fff3e0' },
};

function formatCurrency(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

export default function Leave() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<any>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'my' | 'approve' | 'refund'>('my');

  // 폼
  const [formType, setFormType] = useState<FormLeaveType>('연차/월차');
  const [formStartDate, setFormStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [, setFormReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 시간차 폼
  const [formHours, setFormHours] = useState(1);

  // 특별휴가 폼
  const [specialSubtype, setSpecialSubtype] = useState<SpecialLeaveSubtype>('특별유급휴가');
  const [specialItem, setSpecialItem] = useState(0); // SPECIAL_LEAVE_ITEMS index
  const [specialEtcReason, setSpecialEtcReason] = useState('');

  // 반려 사유
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const role = user?.role || 'member';
  const isApprover = ['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(role);
  const canViewSensitive = ['master', 'ceo', 'cc_ref'].includes(role);
  const canViewOthers = ['master', 'ceo', 'admin', 'accountant', 'accountant_asst'].includes(role);
  const canViewHourly = ['master', 'ceo', 'admin'].includes(role);

  // 담당자 열람 기능
  const [members, setMembers] = useState<User[]>([]);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewBalance, setViewBalance] = useState<any>(null);
  const [viewRequests, setViewRequests] = useState<LeaveRequest[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  useEffect(() => {
    if (canViewOthers) {
      api.users.list().then(res => setMembers((res.users || []).filter((u: User) => u.role !== 'master' && (u as any).login_type !== 'freelancer' && u.id !== user?.id))).catch(() => {});
    }
  }, []);

  const loadViewUser = async (userId: string) => {
    setViewLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.leave.userLeave(userId),
        api.leave.listRequests({ user_id: userId } as any),
      ]);
      setViewBalance(balRes.leave);
      setViewRequests(reqRes.requests?.filter((r: any) => r.user_id === userId) || []);
    } catch (err: any) { console.error(err); }
    finally { setViewLoading(false); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.leave.me(),
        api.leave.listRequests(),
      ]);
      setBalance(balRes.leave);
      // 내 신청 내역: 본인 것만 필터
      setRequests((reqRes.requests || []).filter((r: any) => r.user_id === user?.id));

      if (isApprover) {
        const [pending, cancelReqs] = await Promise.all([
          api.leave.listRequests({ status: 'pending' }),
          api.leave.listRequests({ status: 'cancel_requested' }),
        ]);
        setPendingRequests([...pending.requests, ...cancelReqs.requests]);
      }
    } catch (err: any) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // 템플릿 바로가기: 템플릿으로 새 문서 생성 후 편집 페이지로 이동
  const handleTemplateShortcut = async (templateId: string, title: string) => {
    try {
      const res = await api.documents.create({ title, template_id: templateId });
      if (res.document?.id) {
        navigate('/documents/' + res.document.id);
      } else {
        alert('문서 생성에 실패했습니다.');
      }
    } catch (err: any) { alert(err.message); }
  };

  // 템플릿 매칭
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    api.templates.list().then(res => setTemplates(res.templates)).catch(() => {});
  }, []);
  const annualTemplate = templates.find(t => (t.title.includes('연차') || t.title.includes('월차')) && !t.title.includes('반차') && !t.title.includes('특별'));
  const halfDayTemplate = templates.find(t => t.title.includes('반차'));

  const handleSubmit = async () => {
    // 특별휴가만 사유 검증
    if (formType === '특별휴가') {
      if (specialSubtype === '기타' && !specialEtcReason.trim()) {
        alert('기타 사유를 입력하세요.'); return;
      }
    }

    // 사유 조합
    let reason = '';
    if (formType === '특별휴가') {
      if (specialSubtype === '특별유급휴가') {
        reason = `[특별유급] ${SPECIAL_LEAVE_ITEMS[specialItem].label} (${SPECIAL_LEAVE_ITEMS[specialItem].days}일) ※ 가족관계증명원 전제`;
      } else {
        reason = `[기타] ${specialEtcReason}`;
      }
    }

    // 실제 전송하는 leave_type 결정
    let apiLeaveType: string;
    if (formType === '연차/월차') {
      apiLeaveType = balance?.entitlement?.type === 'monthly' ? '월차' : '연차';
    } else if (formType === '반차') {
      apiLeaveType = '반차';
    } else if (formType === '시간차') {
      apiLeaveType = '시간차';
    } else {
      apiLeaveType = '특별휴가';
    }

    // 차감일수
    const _days = previewDays(); void _days;

    setSubmitting(true);
    try {
      await api.leave.createRequest({
        leave_type: apiLeaveType,
        start_date: formStartDate,
        end_date: formType === '반차' || formType === '시간차' ? formStartDate : formEndDate,
        hours: formType === '시간차' ? formHours : 8,
        reason,
      });
      setShowForm(false);
      setFormReason('');
      setSpecialEtcReason('');
      load();
    } catch (err: any) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('승인하시겠습니까?')) return;
    try { await api.leave.approveRequest(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) { alert('반려 사유를 입력하세요.'); return; }
    try { await api.leave.rejectRequest(id, rejectReason); setRejectingId(null); setRejectReason(''); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleCancel = async (id: string, status: string) => {
    if (status === 'approved') {
      if (!confirm('승인완료된 건입니다. 관리자에게 취소 요청을 하시겠습니까?')) return;
      // 승인된 건 → 취소요청 (관리자 확인 필요)
      try { await api.leave.cancelRequest(id); load(); }
      catch (err: any) { alert(err.message); }
    } else {
      if (!confirm('신청을 취소하시겠습니까?')) return;
      try { await api.leave.cancelRequest(id); load(); }
      catch (err: any) { alert(err.message); }
    }
  };

  // 취소요청 승인 (관리자)
  const handleCancelApprove = async (id: string) => {
    if (!confirm('취소 요청을 승인하시겠습니까? 차감된 연차가 복원됩니다.')) return;
    try { await api.leave.cancelApprove(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  // 차감일수 미리보기
  const previewDays = (): number => {
    if (formType === '반차') return 0.5;
    if (formType === '시간차') return Math.round((formHours / 8) * 1000) / 1000;
    if (formType === '특별휴가' && specialSubtype === '특별유급휴가') {
      return SPECIAL_LEAVE_ITEMS[specialItem].days;
    }
    const start = new Date(formStartDate);
    const end = new Date(formEndDate);
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><CalendarCheck size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 연차 관리</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canViewOthers && (
            <div style={{ minWidth: 200 }}>
              <Select
                options={[{ value: '', label: '내 연차' }, ...members.map(m => ({ value: m.id, label: `${m.name} (${m.department || m.branch || ''})` }))]}
                value={viewUserId ? { value: viewUserId, label: members.find(m => m.id === viewUserId)?.name || '' } : { value: '', label: '내 연차' }}
                onChange={(o: any) => {
                  const id = o?.value || null;
                  setViewUserId(id);
                  if (id) loadViewUser(id);
                  else { setViewBalance(null); setViewRequests([]); }
                }}
                placeholder="담당자 선택..."
                size="sm"
                isSearchable
              />
            </div>
          )}
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> 휴가 신청
          </button>
        </div>
      </div>

      {/* 담당자 연차 열람 모드 */}
      {viewUserId && canViewOthers && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Eye size={18} color="#7b1fa2" />
            <span style={{ fontWeight: 700, color: '#7b1fa2', fontSize: '1rem' }}>
              {members.find(m => m.id === viewUserId)?.name} 연차 현황
            </span>
          </div>

          {viewLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9aa0a6' }}>로딩중...</div>
          ) : viewBalance ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                {viewBalance.entitlement?.type === 'annual' ? (
                  <>
                    <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #7b1fa2' }}>
                      <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>연차 총일수</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#7b1fa2' }}>{viewBalance.total_days}<span style={{ fontSize: '0.75rem', fontWeight: 400 }}>일</span></div>
                    </div>
                    <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #d93025' }}>
                      <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>사용일수</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#d93025' }}>{viewBalance.used_days}<span style={{ fontSize: '0.75rem', fontWeight: 400 }}>일</span></div>
                    </div>
                    <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #188038' }}>
                      <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>잔여일수</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#188038' }}>{viewBalance.annual_remaining}<span style={{ fontSize: '0.75rem', fontWeight: 400 }}>일</span></div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #7b1fa2' }}>
                      <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>월차 총일수</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#7b1fa2' }}>{viewBalance.monthly_days}<span style={{ fontSize: '0.75rem', fontWeight: 400 }}>일</span></div>
                    </div>
                    <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #d93025' }}>
                      <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>사용일수</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#d93025' }}>{viewBalance.monthly_used}<span style={{ fontSize: '0.75rem', fontWeight: 400 }}>일</span></div>
                    </div>
                    <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #188038' }}>
                      <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>잔여일수</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#188038' }}>{viewBalance.monthly_remaining}<span style={{ fontSize: '0.75rem', fontWeight: 400 }}>일</span></div>
                    </div>
                  </>
                )}
                <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #5f6368' }}>
                  <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>입사기준일</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#5f6368' }}>{viewBalance.hire_date || '-'}</div>
                </div>
              </div>

              {/* 열람 대상 휴가 내역 */}
              {viewRequests.length > 0 && (
                <div className="card" style={{ padding: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>휴가 신청 내역</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {viewRequests.filter(req => canViewHourly || req.leave_type !== '시간차').map(req => {
                      const st = STATUS_MAP[req.status] || STATUS_MAP.pending;
                      return (
                        <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 8, fontSize: '0.82rem' }}>
                          <span style={{ background: getTypeColor(req.leave_type), color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 }}>{req.leave_type}</span>
                          <span style={{ color: '#202124' }}>{req.start_date}{req.start_date !== req.end_date ? ` ~ ${req.end_date}` : ''}</span>
                          <span style={{ color: '#5f6368' }}>({req.days}일)</span>
                          <span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 }}>{st.label}</span>
                          {req.reason && <span style={{ color: '#9aa0a6', fontSize: '0.75rem', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.reason}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {viewRequests.length === 0 && (
                <div style={{ textAlign: 'center', color: '#9aa0a6', fontSize: '0.85rem', padding: 20 }}>휴가 신청 내역이 없습니다.</div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* 잔여 현황 카드 */}
      {balance && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          {balance.entitlement.type === 'annual' ? (
            <>
              <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #1a73e8' }}>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>연차 총일수</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a73e8' }}>{balance.total_days}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>일</span></div>
              </div>
              <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #d93025' }}>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>사용일수</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#d93025' }}>{balance.used_days}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>일</span></div>
              </div>
              <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #188038' }}>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>잔여일수</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#188038' }}>{balance.annual_remaining}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>일</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #188038' }}>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>월차 누적</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#188038' }}>{balance.monthly_days}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>일</span></div>
              </div>
              <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #d93025' }}>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>월차 사용</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#d93025' }}>{balance.monthly_used}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>일</span></div>
              </div>
              <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #1a73e8' }}>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>월차 잔여</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a73e8' }}>{balance.monthly_remaining}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>일</span></div>
              </div>
            </>
          )}
          {/* 예상환급금: 대표자 이상 + 회계만 */}
          {canViewSensitive && (
            <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #7b1fa2' }}>
              <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>예상 환급금</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#7b1fa2' }}>{formatCurrency(balance.refund_amount)}</div>
              <div style={{ fontSize: '0.7rem', color: '#9aa0a6', marginTop: 2 }}>월급÷209h×8×잔여일</div>
            </div>
          )}
        </div>
      )}

      {/* 연차촉진 알림 */}
      {balance?.promotion_alert && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 20, border: '1px solid #fbbc04', background: '#fffde7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#f9a825" />
            <strong style={{ color: '#e65100' }}>연차촉진제도 안내</strong>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#5f6368' }}>
            입사 6개월이 경과하여 연차촉진제도가 발동됩니다. 미사용 월차는 입사 1년 시점에 환급 처리됩니다.
          </p>
        </div>
      )}

      {/* 근속 정보 */}
      {balance?.hire_date && (
        <div style={{ marginBottom: 20, fontSize: '0.82rem', color: '#5f6368', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>입사일: <strong>{balance.hire_date}</strong></span>
          <span>근속: <strong>{Math.floor(balance.months_since_hire / 12)}년 {balance.months_since_hire % 12}개월</strong></span>
          <span>유형: <strong style={{ color: balance.entitlement.type === 'monthly' ? '#188038' : '#1a73e8' }}>
            {balance.entitlement.type === 'monthly' ? '월차 누적 방식 (1년 미만)' : '선불 연차 방식 (1년 이상)'}
          </strong></span>
        </div>
      )}

      {/* 근무시간 안내 */}
      <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f8f9fa', borderRadius: 6, borderLeft: '3px solid #dadce0' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', color: '#9aa0a6', lineHeight: 1.6 }}>
          임직원 여러분께 근무시간 관련하여 안내드립니다.
          본 회사는 정규 업무시간 외 추가 근무에 대해 별도의 연장근무수당을 지급하지 않고 있습니다. 이에 따라, 정해진 업무시간을 준수하여 주시기 바랍니다.
          다만, 담당 업무의 성과 향상을 위해 자율적으로 추가 근무를 하시는 부분에 대해서는 각자의 판단에 맡기겠습니다.
        </p>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8eaed', marginBottom: 20 }}>
        <button onClick={() => setTab('my')} style={{ padding: '10px 20px', fontWeight: tab === 'my' ? 700 : 400, color: tab === 'my' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'my' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem' }}>
          <Calendar size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> 내 신청 내역
        </button>
        {isApprover && (
          <button onClick={() => setTab('approve')} style={{ padding: '10px 20px', fontWeight: tab === 'approve' ? 700 : 400, color: tab === 'approve' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'approve' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem', position: 'relative' }}>
            <CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> 승인 대기
            {pendingRequests.length > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, background: '#d93025', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>{pendingRequests.length}</span>
            )}
          </button>
        )}
        {canViewSensitive && (
          <button onClick={() => setTab('refund')} style={{ padding: '10px 20px', fontWeight: tab === 'refund' ? 700 : 400, color: tab === 'refund' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'refund' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem' }}>
            <Calculator size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> 환급 계산
          </button>
        )}
      </div>

      {/* 휴가 신청 폼 */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="journal-form-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="journal-form-header">
              <h3>휴가 신청</h3>
              <button className="btn-close" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div className="journal-form-body">
              {/* 휴가 유형 선택 */}
              <div style={{ marginBottom: 16 }}>
                <label className="form-label">휴가 유형</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {FORM_LEAVE_TYPES.filter(t => canViewHourly || t.value !== '시간차').map(t => (
                    <button key={t.value} type="button" onClick={() => { setFormType(t.value); setSpecialSubtype('특별유급휴가'); setSpecialItem(0); setSpecialEtcReason(''); }}
                      style={{ padding: '10px 6px', borderRadius: 8, border: formType === t.value ? `2px solid ${t.color}` : '1px solid #dadce0', background: formType === t.value ? t.color + '10' : '#fff', cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: formType === t.value ? t.color : '#202124' }}>{t.label}</div>
                      <div style={{ fontSize: '0.65rem', color: '#9aa0a6', marginTop: 2 }}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 특별휴가 세부 */}
              {formType === '특별휴가' && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">구분</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {(['특별유급휴가', '기타'] as SpecialLeaveSubtype[]).map(s => (
                      <button key={s} type="button" onClick={() => setSpecialSubtype(s)}
                        style={{ padding: '6px 14px', borderRadius: 6, border: specialSubtype === s ? '2px solid #7b1fa2' : '1px solid #dadce0', background: specialSubtype === s ? '#f3e5f5' : '#fff', cursor: 'pointer', fontWeight: specialSubtype === s ? 600 : 400, fontSize: '0.85rem', color: specialSubtype === s ? '#7b1fa2' : '#202124' }}>
                        {s}
                      </button>
                    ))}
                  </div>

                  {specialSubtype === '특별유급휴가' && (
                    <div>
                      {SPECIAL_LEAVE_ITEMS.map((item, idx) => (
                        <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer', background: specialItem === idx ? '#ede7f6' : '#fafafa', border: specialItem === idx ? '1px solid #ce93d8' : '1px solid #e8eaed' }}
                          onClick={() => setSpecialItem(idx)}>
                          <input type="radio" name="special-item" checked={specialItem === idx} onChange={() => setSpecialItem(idx)} style={{ marginTop: 2, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: '0.82rem', lineHeight: 1.4, wordBreak: 'keep-all' }}>{item.label}</span>
                          <span style={{ fontWeight: 600, color: '#7b1fa2', fontSize: '0.82rem', flexShrink: 0, whiteSpace: 'nowrap' }}>{item.days}일</span>
                        </label>
                      ))}
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#fff3e0', fontSize: '0.75rem', color: '#e65100', lineHeight: 1.4 }}>
                        ※ 가족관계증명원상의 기록을 전제로 합니다.
                      </div>
                    </div>
                  )}

                  {specialSubtype === '기타' && (
                    <div>
                      <label className="form-label">사유</label>
                      <textarea className="form-input" value={specialEtcReason} onChange={(e) => setSpecialEtcReason(e.target.value)} rows={3} placeholder="특별휴가 사유를 입력하세요" style={{ width: '100%', resize: 'vertical' }} />
                    </div>
                  )}
                </div>
              )}

              {/* 시간차: 시간 선택 */}
              {formType === '시간차' && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">사용 시간</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5, 6, 7].map(h => (
                      <button key={h} type="button" onClick={() => setFormHours(h)}
                        style={{ padding: '8px 14px', borderRadius: 6, border: formHours === h ? '2px solid #5f6368' : '1px solid #dadce0', background: formHours === h ? '#f1f3f4' : '#fff', cursor: 'pointer', fontWeight: formHours === h ? 700 : 400, fontSize: '0.85rem' }}>
                        {h}시간 <span style={{ fontSize: '0.7rem', color: '#9aa0a6' }}>({(h / 8).toFixed(2)}일)</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 날짜 */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">{formType === '반차' || formType === '시간차' ? '날짜' : '시작일'}</label>
                  <input type="date" className="form-input" value={formStartDate} onChange={(e) => { setFormStartDate(e.target.value); if (formType === '반차' || formType === '시간차') setFormEndDate(e.target.value); }} style={{ width: '100%' }} />
                </div>
                {formType !== '반차' && formType !== '시간차' && (
                  <div style={{ flex: 1 }}>
                    <label className="form-label">종료일</label>
                    <input type="date" className="form-input" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} min={formStartDate} style={{ width: '100%' }} />
                  </div>
                )}
              </div>

              {/* 차감 미리보기 */}
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f8f9fa', marginBottom: 16, fontSize: '0.85rem' }}>
                <span style={{ color: '#5f6368' }}>차감일수: </span>
                <strong style={{ color: '#d93025' }}>{previewDays()}일</strong>
                {formType === '특별휴가' && specialSubtype === '특별유급휴가' && (
                  <span style={{ color: '#7b1fa2', marginLeft: 8, fontSize: '0.78rem' }}>({SPECIAL_LEAVE_ITEMS[specialItem].label})</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting} style={{ flex: 1 }}>
                  {submitting ? '제출중...' : '신청하기'}
                </button>
                <button className="btn" onClick={() => setShowForm(false)}>취소</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 내 신청 내역 */}
      {tab === 'my' && (
        <div>
          {/* 템플릿 바로가기 버튼 */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button className="btn"
              onClick={() => annualTemplate
                ? handleTemplateShortcut(annualTemplate.id, annualTemplate.title)
                : navigate('/templates')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid #1a73e8', color: '#1a73e8', background: '#eff6ff' }}>
              <FileText size={15} /> 연차휴가신청서 작성 <ExternalLink size={12} />
            </button>
            <button className="btn"
              onClick={() => halfDayTemplate
                ? handleTemplateShortcut(halfDayTemplate.id, halfDayTemplate.title)
                : navigate('/templates')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid #e65100', color: '#e65100', background: '#fff8f0' }}>
              <FileText size={15} /> 반차신청서 작성 <ExternalLink size={12} />
            </button>
          </div>

          {requests.length === 0 ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: '#9aa0a6' }}>
              휴가 신청 내역이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {requests.filter(req => canViewHourly || req.leave_type !== '시간차').map(req => {
                const st = STATUS_MAP[req.status];
                const typeColor = getTypeColor(req.leave_type);
                const canCancel = req.status === 'pending' || req.status === 'approved';
                return (
                  <div key={req.id} className="card" style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, background: typeColor + '18', color: typeColor }}>{req.leave_type}</span>
                        {req.leave_type === '특별휴가' && req.reason?.startsWith('[기타]') && (
                          <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>무급</span>
                        )}
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {req.start_date === req.end_date ? req.start_date : `${req.start_date} ~ ${req.end_date}`}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>({req.days}일)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                        {canCancel && (
                          <button className="btn btn-sm" onClick={() => handleCancel(req.id, req.status)} style={{ fontSize: '0.75rem' }}>
                            {req.status === 'approved' ? '취소요청' : '취소'}
                          </button>
                        )}
                        {role === 'master' && (
                          <button className="btn btn-sm btn-danger" onClick={async () => {
                            if (!confirm(`이 휴가 신청을 삭제하시겠습니까?\n${req.status === 'approved' ? '승인된 건이므로 차감된 연차가 복원됩니다.' : ''}`)) return;
                            try { await api.leave.deleteRequest(req.id); load(); }
                            catch (err: any) { alert(err.message); }
                          }} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>삭제</button>
                        )}
                      </div>
                    </div>
                    {req.reason && <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#5f6368' }}>{req.reason}</div>}
                    {req.reject_reason && <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#d93025' }}>반려 사유: {req.reject_reason}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 승인 대기 */}
      {tab === 'approve' && isApprover && (
        <div>
          {pendingRequests.length === 0 ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: '#9aa0a6' }}>
              승인 대기 중인 신청이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingRequests.filter(req => canViewHourly || req.leave_type !== '시간차').map(req => {
                const typeColor = getTypeColor(req.leave_type);
                const isRejecting = rejectingId === req.id;
                return (
                  <div key={req.id} className="card" style={{ padding: '16px 20px', border: '1px solid #bfdbfe' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{req.user_name}</strong>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, background: typeColor + '18', color: typeColor }}>{req.leave_type}</span>
                        {req.leave_type === '특별휴가' && req.reason?.startsWith('[기타]') && (
                          <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>무급</span>
                        )}
                        <span style={{ fontSize: '0.85rem' }}>
                          {req.start_date === req.end_date ? req.start_date : `${req.start_date} ~ ${req.end_date}`}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>({req.days}일)</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {req.status === 'cancel_requested' ? (
                          <>
                            <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>취소요청</span>
                            <button className="btn btn-sm btn-danger" onClick={() => handleCancelApprove(req.id)}>
                              <CheckCircle size={13} /> 취소승인
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => handleApprove(req.id)}>
                              <CheckCircle size={13} /> 승인
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => setRejectingId(isRejecting ? null : req.id)}>
                              <XCircle size={13} /> 반려
                            </button>
                          </>
                        )}
                        {role === 'master' && (
                          <button className="btn btn-sm" onClick={async () => {
                            if (!confirm('이 신청을 삭제하시겠습니까?')) return;
                            try { await api.leave.deleteRequest(req.id); load(); }
                            catch (err: any) { alert(err.message); }
                          }} style={{ fontSize: '0.7rem', padding: '2px 6px', color: '#9aa0a6' }}>삭제</button>
                        )}
                      </div>
                    </div>
                    {req.reason && <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#5f6368' }}>{req.reason}</div>}
                    {isRejecting && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>반려 사유</label>
                          <input className="form-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유" style={{ width: '100%' }} />
                        </div>
                        <button className="btn btn-sm btn-danger" onClick={() => handleReject(req.id)}>확인</button>
                        <button className="btn btn-sm" onClick={() => { setRejectingId(null); setRejectReason(''); }}>취소</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 환급 계산 - 대표자 이상 + 회계만 */}
      {tab === 'refund' && canViewSensitive && (
        <RefundCalc />
      )}
    </div>
  );
}

// 환급 계산 컴포넌트
function RefundCalc() {
  const [members, setMembers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [refundData, setRefundData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.journal.members().then(res => setMembers((res.members || []).filter((m: any) => m.login_type !== 'freelancer' && m.role !== 'freelancer'))).catch(() => {});
  }, []);

  const calculate = async () => {
    if (!selectedUser) { alert('대상자를 선택하세요.'); return; }
    setLoading(true);
    try {
      const data = await api.leave.refund(selectedUser);
      setRefundData(data);
    } catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div className="card" style={{ padding: '20px', marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>
          <Calculator size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> 연차 환급 계산
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#5f6368', margin: '0 0 16px' }}>
          환급 공식: <strong>월급 ÷ 209시간 × 8시간 × 잔여일수</strong>
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <label className="form-label">대상자 선택</label>
            <select className="form-input" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} style={{ width: '100%' }}>
              <option value="">선택...</option>
              {members.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name} ({m.department})</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={calculate} disabled={loading}>
            {loading ? '계산중...' : '환급금 계산'}
          </button>
        </div>
      </div>

      {refundData && (
        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '0.95rem' }}>{refundData.user_name} 환급 내역</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>월급</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{formatCurrency(refundData.salary)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>잔여일수</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem', color: '#1a73e8' }}>{refundData.remaining_days}일</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>1일 환급액</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{formatCurrency(refundData.refund_per_day)}</div>
            </div>
            <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: '#188038' }}>총 환급금액</div>
              <div style={{ fontWeight: 700, fontSize: '1.3rem', color: '#188038' }}>{formatCurrency(refundData.refund_total)}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#9aa0a6' }}>
            계산식: {formatCurrency(refundData.salary)} ÷ 209h × 8h × {refundData.remaining_days}일 = {formatCurrency(refundData.refund_total)}
          </div>
        </div>
      )}
    </div>
  );
}
