import { useRef, useState, useEffect } from 'react';
import { api } from '../api';
import { Save, Trash2 } from 'lucide-react';

export type SignatureType = 'author' | 'approver';

interface Props {
  documentId: string;
  signatureType: SignatureType;
  onClose: () => void;
  onSign: (signatureData: string, type: SignatureType) => void;
}

const SAVED_SIG_KEY = 'myauction_saved_signature';

/** 저장된 서명이 있는지 확인 */
export function hasSavedSignature(): boolean {
  return !!localStorage.getItem(SAVED_SIG_KEY);
}

/** 저장된 서명으로 즉시 서명 처리 */
export async function quickSign(documentId: string, signatureType: SignatureType, onSign: (data: string, type: SignatureType) => void) {
  const saved = localStorage.getItem(SAVED_SIG_KEY);
  if (!saved) return false;
  await api.signatures.sign(documentId, saved);
  onSign(saved, signatureType);
  return true;
}

export default function SignaturePanel({ documentId, signatureType, onClose, onSign }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);

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

  const saveCurrentSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const data = canvas.toDataURL('image/png');
    localStorage.setItem(SAVED_SIG_KEY, data);
    setSavedSignature(data);
    alert('서명이 저장되었습니다. 다음부터 서명 버튼 클릭만으로 자동 서명됩니다.');
  };

  const deleteSavedSignature = () => {
    if (!confirm('저장된 서명을 삭제하시겠습니까?')) return;
    localStorage.removeItem(SAVED_SIG_KEY);
    setSavedSignature(null);
    setUsingSaved(false);
  };

  const handleSign = async () => {
    if (!hasDrawn) {
      setError('서명을 그려주세요.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const signatureData = usingSaved && savedSignature
        ? savedSignature
        : canvasRef.current!.toDataURL('image/png');

      // 새로 그린 서명이면 자동 저장
      if (!usingSaved) {
        localStorage.setItem(SAVED_SIG_KEY, signatureData);
        setSavedSignature(signatureData);
      }

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

      {/* 저장된 서명 관리 */}
      {savedSignature && (
        <div className="saved-sig-section">
          <div className="saved-sig-header">
            <span className="saved-sig-label">저장된 서명</span>
            <div className="saved-sig-actions">
              <button className="btn btn-sm btn-danger" onClick={deleteSavedSignature}>
                <Trash2 size={12} /> 삭제
              </button>
            </div>
          </div>
          <img src={savedSignature} alt="저장된 서명" className="saved-sig-preview" />
          <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>
            서명이 등록되어 있어 버튼 클릭만으로 자동 서명됩니다.
          </p>
        </div>
      )}

      {/* 캔버스: 저장된 서명 없을 때만 표시 */}
      {!savedSignature && (
        <div className="signature-canvas-wrapper">
          <p className="signature-notice">최초 서명을 그려주세요. 이후 자동으로 사용됩니다.</p>
          <canvas
            ref={canvasRef}
            width={240}
            height={120}
            className="signature-canvas"
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
            {hasDrawn && (
              <button className="btn btn-sm" onClick={saveCurrentSignature}>
                <Save size={12} /> 서명 저장
              </button>
            )}
          </div>
        </div>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleSign}
        disabled={submitting || (!hasDrawn && !savedSignature)}
        style={{ marginTop: '0.75rem' }}
      >
        {submitting ? '서명 처리중...' : `${typeLabel} 하기`}
      </button>
    </div>
  );
}
