import { useRef, useState, useEffect } from 'react';
import { api } from '../api';

export type SignatureType = 'author' | 'approver';

interface Props {
  documentId: string;
  signatureType: SignatureType;
  onClose: () => void;
  onSign: (signatureData: string, type: SignatureType) => void;
}

export default function SignaturePanel({ documentId, signatureType, onClose, onSign }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    setHasDrawn(true);
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleSign = async () => {
    if (!hasDrawn) {
      setError('서명을 그려주세요.');
      return;
    }
    if (!password) {
      setError('비밀번호를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const signatureData = canvasRef.current!.toDataURL('image/png');
      await api.signatures.sign(documentId, signatureData);
      onSign(signatureData, signatureType);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const typeLabel = signatureType === 'author' ? '작성자 서명' : '승인자 서명';
  const typeDesc = signatureType === 'author'
    ? '서명하면 문서의 작성자(인) 란에 서명 이미지가 삽입됩니다.'
    : '서명하면 문서의 결재란에 서명 이미지가 삽입됩니다.';

  return (
    <div className="side-panel signature-panel">
      <div className="side-panel-header">
        <h4>{typeLabel}</h4>
        <button className="btn-close" onClick={onClose}>×</button>
      </div>

      <p className="signature-notice">{typeDesc}</p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="signature-canvas-wrapper">
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
        <button className="btn btn-sm" onClick={clear} style={{ marginTop: '0.5rem' }}>
          서명 초기화
        </button>
      </div>

      <div className="form-group" style={{ marginTop: '1rem' }}>
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
