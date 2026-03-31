import { useRef, useState, useEffect } from 'react';
import { api } from '../api';
import { Save, Upload, Trash2 } from 'lucide-react';

export type SignatureType = 'author' | 'approver';

interface Props {
  documentId: string;
  signatureType: SignatureType;
  onClose: () => void;
  onSign: (signatureData: string, type: SignatureType) => void;
}

const SAVED_SIG_KEY = 'myauction_saved_signature';

export default function SignaturePanel({ documentId, signatureType, onClose, onSign }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);

  // 저장된 서명 로드
  useEffect(() => {
    const saved = localStorage.getItem(SAVED_SIG_KEY);
    if (saved) setSavedSignature(saved);
  }, []);

  useEffect(() => {
    initCanvas();
  }, []);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    setHasDrawn(true);
    setUsingSaved(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => setIsDrawing(false);

  const clear = () => {
    initCanvas();
    setHasDrawn(false);
    setUsingSaved(false);
  };

  // 저장된 서명 불러오기
  const loadSavedSignature = () => {
    if (!savedSignature) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setHasDrawn(true);
      setUsingSaved(true);
    };
    img.src = savedSignature;
  };

  // 현재 서명 저장
  const saveCurrentSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const data = canvas.toDataURL('image/png');
    localStorage.setItem(SAVED_SIG_KEY, data);
    setSavedSignature(data);
    alert('서명이 저장되었습니다. 다음부터 불러오기로 사용할 수 있습니다.');
  };

  // 저장된 서명 삭제
  const deleteSavedSignature = () => {
    if (!confirm('저장된 서명을 삭제하시겠습니까?')) return;
    localStorage.removeItem(SAVED_SIG_KEY);
    setSavedSignature(null);
    setUsingSaved(false);
  };

  const handleSign = async () => {
    if (!hasDrawn) {
      setError('서명을 그리거나 저장된 서명을 불러와주세요.');
      return;
    }
    if (!password) {
      setError('비밀번호를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const signatureData = usingSaved && savedSignature
        ? savedSignature
        : canvasRef.current!.toDataURL('image/png');
      await api.signatures.sign(documentId, signatureData);
      onSign(signatureData, signatureType);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const typeLabel = signatureType === 'author' ? '작성자 서명' : '승인자 서명';

  return (
    <div className="side-panel signature-panel">
      <div className="side-panel-header">
        <h4>{typeLabel}</h4>
        <button className="btn-close" onClick={onClose}>×</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 저장된 서명 영역 */}
      {savedSignature && (
        <div className="saved-sig-section">
          <div className="saved-sig-header">
            <span className="saved-sig-label">저장된 서명</span>
            <div className="saved-sig-actions">
              <button className="btn btn-sm btn-primary" onClick={loadSavedSignature}>
                <Upload size={12} /> 불러오기
              </button>
              <button className="btn btn-sm btn-danger" onClick={deleteSavedSignature}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <img src={savedSignature} alt="저장된 서명" className="saved-sig-preview" />
          {usingSaved && <span className="saved-sig-using">저장된 서명 사용중</span>}
        </div>
      )}

      {/* 캔버스 영역 */}
      <div className="signature-canvas-wrapper">
        {!usingSaved && <p className="signature-notice">아래에 서명을 그려주세요.</p>}
        <canvas
          ref={canvasRef}
          width={240}
          height={120}
          className={`signature-canvas ${usingSaved ? 'using-saved' : ''}`}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <div className="signature-canvas-btns">
          <button className="btn btn-sm" onClick={clear}>초기화</button>
          {hasDrawn && !usingSaved && (
            <button className="btn btn-sm" onClick={saveCurrentSignature}>
              <Save size={12} /> 서명 저장
            </button>
          )}
        </div>
      </div>

      <div className="form-group" style={{ marginTop: '0.75rem' }}>
        <label>비밀번호 확인</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호를 입력하세요"
        />
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={handleSign}
        disabled={submitting || !hasDrawn}
      >
        {submitting ? '서명 처리중...' : `${typeLabel} 하기`}
      </button>
    </div>
  );
}
