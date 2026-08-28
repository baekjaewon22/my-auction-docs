import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Cloud,
  Download,
  ExternalLink,
  FileCheck2,
  GripVertical,
  ImagePlus,
  Plus,
  Receipt,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  type ExpenseReceiptAttachment,
  type ExpenseReceiptDetail,
} from '../api';
import SignaturePanel, { hasSavedSignature, quickSign } from '../components/SignaturePanel';
import { useAuthStore } from '../store';
import type { ApprovalStep, Document as OfficeDocument, Signature } from '../types';
import {
  EXPENSE_RECEIPT_MAX_FILES,
  EXPENSE_RECEIPT_PAYMENT_METHODS,
  EXPENSE_RECEIPT_TEMPLATE_ID,
  createExpenseReceiptDraft,
  expenseReceiptFileSha256,
  expenseReceiptImageTargetSize,
  expenseReceiptTotal,
  formatExpenseReceiptBytes,
  formatExpenseReceiptDateTime,
  matchCommittedExpenseReceiptUploads,
  moveExpenseReceiptItem,
  parseExpenseReceiptContent,
  serializeExpenseReceiptContent,
  validateExpenseReceiptFiles,
  validateExpenseReceiptForSubmit,
  type ExpenseReceiptFormDraft,
} from '../lib/expense-receipt';

type LocalReceipt = {
  key: string;
  file: File;
  previewUrl: string;
};

type ReceiptOrderItem =
  | { kind: 'existing'; id: string }
  | { kind: 'local'; key: string };

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '작성중', className: 'status-draft' },
  submitted: { label: '제출', className: 'status-submitted' },
  approved: { label: '승인', className: 'status-approved' },
  rejected: { label: '반려', className: 'status-rejected' },
  cancel_requested: { label: '취소 신청', className: 'status-cancel-req' },
  cancelled: { label: '취소', className: 'status-cancelled' },
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type ExpenseAccountDefaults = {
  bank_name: string;
  account_number: string;
  account_holder: string;
  account_note: string;
};

const EXPENSE_ACCOUNT_DEFAULTS_KEY = 'myauction-expense-account';

// 결제 지급 계좌 정보를 사용자별 localStorage에 기억한다(기기 단위).
// 두 번째 작성부터는 '저장된 계좌정보 불러오기'로 재입력을 생략할 수 있다.
function loadExpenseAccountDefaults(userId: string): ExpenseAccountDefaults | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${EXPENSE_ACCOUNT_DEFAULTS_KEY}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExpenseAccountDefaults>;
    const defaults: ExpenseAccountDefaults = {
      bank_name: String(parsed.bank_name || ''),
      account_number: String(parsed.account_number || ''),
      account_holder: String(parsed.account_holder || ''),
      account_note: String(parsed.account_note || ''),
    };
    return (defaults.bank_name || defaults.account_number || defaults.account_holder || defaults.account_note)
      ? defaults
      : null;
  } catch {
    return null;
  }
}

function saveExpenseAccountDefaults(userId: string, form: ExpenseReceiptFormDraft): void {
  if (!userId) return;
  const defaults: ExpenseAccountDefaults = {
    bank_name: form.bank_name.trim(),
    account_number: form.account_number.trim(),
    account_holder: form.account_holder.trim(),
    account_note: form.account_note.trim(),
  };
  if (!defaults.bank_name && !defaults.account_number && !defaults.account_holder && !defaults.account_note) return;
  try {
    localStorage.setItem(`${EXPENSE_ACCOUNT_DEFAULTS_KEY}:${userId}`, JSON.stringify(defaults));
  } catch {
    /* localStorage 사용 불가 시 무시 */
  }
}

function formatWon(value: number): string {
  return `${Math.max(0, value).toLocaleString('ko-KR')}원`;
}

function isHeicReceiptFile(file: File): boolean {
  return /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function convertExpenseReceiptHeicToJpegBestEffort(file: File): Promise<File> {
  const isHeic = isHeicReceiptFile(file);
  const isSupportedImage = /image\/(jpeg|png|webp)/i.test(file.type)
    || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!isHeic && !isSupportedImage) return file;

  let source: CanvasImageSource | null = null;
  let width = 0;
  let height = 0;
  let releaseSource: () => void = () => {};
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
      releaseSource = () => bitmap.close();
    } catch {
      // Some mobile browsers expose createImageBitmap but do not decode HEIC.
    }
  }

  if (!source) {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('HEIC decode failed')), { once: true });
        image.src = objectUrl;
      });
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
      releaseSource = () => URL.revokeObjectURL(objectUrl);
    } catch {
      URL.revokeObjectURL(objectUrl);
      return file;
    }
  }

  try {
    if (!source || width < 1 || height < 1) return file;
    const target = expenseReceiptImageTargetSize(width, height, file.size, isHeic);
    if (!target) return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) return file;
    if (!isHeic && !target.resized && jpeg.size >= file.size) return file;
    const baseName = file.name.replace(/\.(heic|heif|jpe?g|png|webp)$/i, '') || 'receipt';
    return new File([jpeg], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    releaseSource();
  }
}

export default function ExpenseReceiptApplication() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const userSnapshot = useMemo(() => ({
    name: user?.name || '',
    department: user?.department || '',
    position_title: user?.position_title || '',
  }), [user?.department, user?.name, user?.position_title]);
  const [documentId, setDocumentId] = useState(routeId || '');
  const [doc, setDoc] = useState<OfficeDocument | null>(null);
  const [form, setForm] = useState<ExpenseReceiptFormDraft>(() => createExpenseReceiptDraft(user || {}));
  const [detail, setDetail] = useState<ExpenseReceiptDetail | null>(null);
  const [attachments, setAttachments] = useState<ExpenseReceiptAttachment[]>([]);
  const [localReceipts, setLocalReceipts] = useState<LocalReceipt[]>([]);
  const [receiptOrder, setReceiptOrder] = useState<ReceiptOrderItem[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);
  const [loading, setLoading] = useState(Boolean(routeId));
  const [busy, setBusy] = useState(false);
  const [preparingFiles, setPreparingFiles] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [signatureDocumentId, setSignatureDocumentId] = useState('');
  const [signatureRevision, setSignatureRevision] = useState<number | undefined>();
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [accountDefaults, setAccountDefaults] = useState<ExpenseAccountDefaults | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [showCancelRequest, setShowCancelRequest] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localReceiptsRef = useRef<LocalReceipt[]>([]);
  const preparingFilesRef = useRef(false);

  const loadDocument = useCallback(async (targetId: string) => {
    setLoading(true);
    setErrors([]);
    try {
      const [documentResponse, receiptResponse, signatureResponse, stepsResponse] = await Promise.all([
        api.documents.get(targetId),
        api.expenseReceipts.get(targetId),
        api.signatures.getByDocument(targetId),
        api.documents.steps(targetId).catch(() => ({ steps: [] })),
      ]);
      if (documentResponse.document.template_id !== EXPENSE_RECEIPT_TEMPLATE_ID) {
        navigate(`/documents/${targetId}`, { replace: true });
        return;
      }
      setDoc(documentResponse.document);
      setDocumentId(targetId);
      setForm(parseExpenseReceiptContent(documentResponse.document.content, userSnapshot));
      setDetail(receiptResponse);
      setAttachments(receiptResponse.attachments || []);
      setReceiptOrder((receiptResponse.attachments || []).map((attachment) => ({ kind: 'existing' as const, id: attachment.id })));
      setSignatures(signatureResponse.signatures || []);
      setApprovalSteps(stepsResponse.steps || []);
    } catch (error) {
      setErrors([errorText(error, '영수증 첨부 지출결의서를 불러오지 못했습니다.')]);
    } finally {
      setLoading(false);
    }
  }, [navigate, userSnapshot]);

  useEffect(() => {
    if (routeId) loadDocument(routeId);
    else {
      setDocumentId('');
      setDoc(null);
      setDetail(null);
      setAttachments([]);
      setReceiptOrder([]);
      setForm(createExpenseReceiptDraft(userSnapshot));
      setLoading(false);
    }
  }, [routeId, loadDocument, userSnapshot]);

  useEffect(() => {
    localReceiptsRef.current = localReceipts;
  }, [localReceipts]);

  useEffect(() => () => {
    localReceiptsRef.current.forEach((receipt) => URL.revokeObjectURL(receipt.previewUrl));
  }, []);

  useEffect(() => {
    if (!documentId || attachments.length === 0) {
      setPreviewUrls({});
      return;
    }
    let active = true;
    const generated: string[] = [];
    Promise.all(attachments.map(async (attachment) => {
      try {
        const url = await api.expenseReceipts.attachmentPreview(documentId, attachment.id);
        generated.push(url);
        return [attachment.id, url] as const;
      } catch {
        return [attachment.id, ''] as const;
      }
    })).then((entries) => {
      if (active) setPreviewUrls(Object.fromEntries(entries));
    });
    return () => {
      active = false;
      generated.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments, documentId]);

  const editable = !doc || (
    (doc.status === 'draft' || doc.status === 'rejected') &&
    (doc.author_id === user?.id || user?.role === 'master')
  );
  const uiBusy = busy || preparingFiles;
  const authorId = doc?.author_id || user?.id || '';
  const authorSignature = signatures.find((signature) => signature.user_id === authorId && Boolean(signature.signature_data));
  const representativeStep = approvalSteps[0];
  const approvalAction = doc?.expense_receipt_approval_action || null;
  const canApprove = Boolean(doc?.can_expense_receipt_approve);
  const canReject = Boolean(doc?.can_expense_receipt_reject);
  const canRevertApproval = ['master', 'ceo', 'accountant', 'accountant_asst'].includes(user?.role || '');
  const total = useMemo(() => expenseReceiptTotal(form.items), [form.items]);
  const attachmentById = useMemo(() => new Map(attachments.map((attachment) => [attachment.id, attachment])), [attachments]);
  const localByKey = useMemo(() => new Map(localReceipts.map((receipt) => [receipt.key, receipt])), [localReceipts]);
  const totalReceiptBytes = attachments.reduce((sum, attachment) => sum + attachment.file_size, 0)
    + localReceipts.reduce((sum, receipt) => sum + receipt.file.size, 0);

  useEffect(() => {
    if (user?.id) setAccountDefaults(loadExpenseAccountDefaults(user.id));
  }, [user?.id]);

  const applyAccountDefaults = () => {
    if (!accountDefaults || !editable) return;
    setForm((current) => ({
      ...current,
      bank_name: accountDefaults.bank_name,
      account_number: accountDefaults.account_number,
      account_holder: accountDefaults.account_holder,
      account_note: accountDefaults.account_note,
    }));
    setErrors([]);
    setNotice('저장된 계좌정보를 불러왔습니다.');
  };

  const updateForm = <K extends keyof ExpenseReceiptFormDraft>(key: K, value: ExpenseReceiptFormDraft[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors([]);
    setNotice('');
  };

  const updateItem = (index: number, field: 'description' | 'amount' | 'note', value: string) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index
        ? { ...item, [field]: field === 'amount' ? value.replace(/[^\d]/g, '') : value }
        : item),
    }));
    setErrors([]);
  };

  const addItem = () => {
    const created = createExpenseReceiptDraft({}).items[0];
    setForm((current) => ({ ...current, items: [...current.items, created] }));
  };

  const removeItem = (index: number) => {
    if (form.items.length <= 3) return;
    setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const addReceiptFiles = async (selectedFiles: File[]) => {
    if (selectedFiles.length === 0 || busy || preparingFilesRef.current) return;
    preparingFilesRef.current = true;
    setPreparingFiles(true);
    try {
      // Process sequentially to avoid decoding several high-resolution phone
      // photos into memory at once on mobile devices.
      const preparedResults: Array<{ original: File; file: File }> = [];
      for (const selectedFile of selectedFiles) {
        preparedResults.push({
          original: selectedFile,
          file: await convertExpenseReceiptHeicToJpegBestEffort(selectedFile),
        });
      }
      const preparedFiles = preparedResults.map((result) => result.file);
      const validation = validateExpenseReceiptFiles(preparedFiles, receiptOrder.length, totalReceiptBytes);
      setErrors(validation.errors);
      if (validation.accepted.length === 0) return;
      const acceptedFiles = new Set<File>(validation.accepted);
      const acceptedResults = preparedResults.filter((result) => acceptedFiles.has(result.file));
      const convertedCount = acceptedResults.reduce((count, result) => count + Number(result.file !== result.original), 0);
      const convertedHeicCount = acceptedResults.reduce(
        (count, result) => count + Number(result.file !== result.original && isHeicReceiptFile(result.original)),
        0,
      );
      const created = validation.accepted.map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setLocalReceipts((current) => [...current, ...created]);
      setReceiptOrder((current) => [...current, ...created.map((receipt) => ({ kind: 'local' as const, key: receipt.key }))]);
      const optimizedCount = convertedCount - convertedHeicCount;
      const convertedNotice = convertedCount > 0
        ? ` ${convertedHeicCount > 0 ? `HEIC ${convertedHeicCount}장 자동 변환` : ''}${convertedHeicCount > 0 && optimizedCount > 0 ? ' · ' : ''}${optimizedCount > 0 ? `큰 사진 ${optimizedCount}장 용량 최적화` : ''}를 완료했습니다.`
        : '';
      setNotice(`${created.length}장의 영수증을 추가했습니다.${convertedNotice} 임시저장 또는 제출 시 서버에 저장됩니다.`);
    } finally {
      preparingFilesRef.current = false;
      setPreparingFiles(false);
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    void addReceiptFiles(Array.from(event.target.files || []));
    event.currentTarget.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (!editable || busy || preparingFilesRef.current) return;
    void addReceiptFiles(Array.from(event.dataTransfer.files || []));
  };

  const removeReceipt = async (orderItem: ReceiptOrderItem) => {
    if (!editable || busy || preparingFilesRef.current) return;
    if (orderItem.kind === 'local') {
      const target = localByKey.get(orderItem.key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      setLocalReceipts((current) => current.filter((receipt) => receipt.key !== orderItem.key));
      setReceiptOrder((current) => current.filter((item) => !(item.kind === 'local' && item.key === orderItem.key)));
      return;
    }
    if (!documentId || !confirm('저장된 영수증 이미지를 삭제하시겠습니까?')) return;
    setBusy(true);
    try {
      const response = await api.expenseReceipts.deleteAttachment(documentId, orderItem.id);
      setAttachments(response.attachments);
      setReceiptOrder((current) => current.filter((item) => !(item.kind === 'existing' && item.id === orderItem.id)));
      setNotice('영수증 이미지를 삭제했습니다.');
    } catch (error) {
      setErrors([errorText(error, '영수증을 삭제하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const moveReceipt = (from: number, to: number) => {
    if (!editable || busy || preparingFilesRef.current) return;
    setReceiptOrder((current) => moveExpenseReceiptItem(current, from, to));
  };

  const persistReceipts = async (targetDocumentId: string): Promise<ExpenseReceiptAttachment[]> => {
    const existingAttachmentIds = new Set(attachments.map((attachment) => attachment.id));
    let pendingUploads: Array<{ key: string; sha256: string; size: number }> = [];
    try {
      let serverAttachments = attachments;
      let targetOrder = receiptOrder;
      if (localReceipts.length > 0) {
        const localOrder = receiptOrder.filter((item): item is Extract<ReceiptOrderItem, { kind: 'local' }> => item.kind === 'local');
        const orderedLocalReceipts = localOrder
          .map((item) => localByKey.get(item.key))
          .filter((receipt): receipt is LocalReceipt => Boolean(receipt));
        const orderedFiles = orderedLocalReceipts.map((receipt) => receipt.file);
        pendingUploads = await Promise.all(orderedLocalReceipts.map(async (receipt) => ({
          key: receipt.key,
          sha256: await expenseReceiptFileSha256(receipt.file),
          size: receipt.file.size,
        })));
        const uploaded = await api.expenseReceipts.upload(targetDocumentId, orderedFiles);
        const newAttachments = uploaded.attachments.filter((attachment) => !existingAttachmentIds.has(attachment.id));
        if (newAttachments.length !== localOrder.length) throw new Error('업로드된 영수증 순서를 확인하지 못했습니다. 다시 시도해 주세요.');
        const uploadedIdByKey = new Map(localOrder.map((item, index) => [item.key, newAttachments[index].id]));
        targetOrder = receiptOrder.map((item) => item.kind === 'existing'
          ? item
          : { kind: 'existing' as const, id: uploadedIdByKey.get(item.key) || '' });
        serverAttachments = uploaded.attachments;
      }

      const desiredIds = targetOrder
        .filter((item): item is Extract<ReceiptOrderItem, { kind: 'existing' }> => item.kind === 'existing' && Boolean(item.id))
        .map((item) => item.id);
      const currentIds = serverAttachments.map((attachment) => attachment.id);
      if (desiredIds.length > 0 && desiredIds.join('|') !== currentIds.join('|')) {
        const reordered = await api.expenseReceipts.reorder(targetDocumentId, desiredIds);
        serverAttachments = reordered.attachments;
      }

      localReceipts.forEach((receipt) => URL.revokeObjectURL(receipt.previewUrl));
      setLocalReceipts([]);
      setAttachments(serverAttachments);
      setReceiptOrder(serverAttachments.map((attachment) => ({ kind: 'existing', id: attachment.id })));
      return serverAttachments;
    } catch (error) {
      // The upload may have committed even if the response or the following
      // reorder request failed. Reconcile with the server so retrying does not
      // upload the same SHA again and trap the user in a 409 loop.
      const latest = await api.expenseReceipts.get(targetDocumentId).catch(() => null);
      if (latest) {
        const newlyCommitted = latest.attachments.filter((attachment) => !existingAttachmentIds.has(attachment.id));
        const committedIdByLocalKey = matchCommittedExpenseReceiptUploads(pendingUploads, newlyCommitted);
        const committedKeys = new Set(Object.keys(committedIdByLocalKey));
        localReceipts
          .filter((receipt) => committedKeys.has(receipt.key))
          .forEach((receipt) => URL.revokeObjectURL(receipt.previewUrl));
        setLocalReceipts(localReceipts.filter((receipt) => !committedKeys.has(receipt.key)));
        setAttachments(latest.attachments);
        const reconciledOrder: ReceiptOrderItem[] = receiptOrder.map((item) => {
          if (item.kind === 'existing') return item;
          const committedId = committedIdByLocalKey[item.key];
          return committedId ? { kind: 'existing' as const, id: committedId } : item;
        });
        const representedIds = new Set(reconciledOrder
          .filter((item): item is Extract<ReceiptOrderItem, { kind: 'existing' }> => item.kind === 'existing')
          .map((item) => item.id));
        latest.attachments.forEach((attachment) => {
          if (!representedIds.has(attachment.id)) reconciledOrder.push({ kind: 'existing', id: attachment.id });
        });
        setReceiptOrder(reconciledOrder);
      }
      throw error;
    }
  };

  const persistDraft = async (): Promise<string> => {
    const content = serializeExpenseReceiptContent(form);
    let targetDocumentId = documentId;
    const currentDocument = doc;
    if (!targetDocumentId) {
      const created = await api.documents.create({
        title: '영수증 첨부 지출결의서',
        template_id: EXPENSE_RECEIPT_TEMPLATE_ID,
        content,
      });
      targetDocumentId = created.document.id;
      setDocumentId(targetDocumentId);
    } else {
      await api.documents.update(targetDocumentId, { title: '영수증 첨부 지출결의서', content });
      if (currentDocument) setDoc({ ...currentDocument, content, title: '영수증 첨부 지출결의서' });
    }
    const savedAttachments = await persistReceipts(targetDocumentId);
    setDetail((current) => current ? { ...current, attachments: savedAttachments } : current);
    const signatureResponse = await api.signatures.getByDocument(targetDocumentId);
    setSignatures(signatureResponse.signatures || []);
    setSavedAt(new Date());
    return targetDocumentId;
  };

  const handleSaveDraft = async () => {
    if (!editable || busy || preparingFilesRef.current) return;
    setBusy(true);
    setErrors([]);
    setNotice('');
    try {
      const savedDocumentId = await persistDraft();
      saveExpenseAccountDefaults(user?.id || '', form);
      setNotice('임시저장했습니다.');
      if (!routeId) navigate(`/expense-receipts/${savedDocumentId}`, { replace: true });
    } catch (error) {
      setErrors([errorText(error, '임시저장하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!editable || busy || preparingFilesRef.current) return;
    const validationErrors = validateExpenseReceiptForSubmit(form, receiptOrder.length);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      // 서명은 항상 마지막 단계: 최종 내용을 저장한 그 버전에 서명하고 곧바로 제출한다.
      const savedDocumentId = await persistDraft();
      const latestDocument = await api.documents.get(savedDocumentId);
      const revision = latestDocument.document.expense_receipt_revision;
      if (!revision) throw new Error('제출할 문서 버전을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.');
      setDoc(latestDocument.document);
      if (!hasSavedSignature()) {
        // 저장된 서명이 없으면 한 번만 그리게 하고, 서명 완료 시 자동으로 제출한다.
        setSignatureRevision(revision);
        setSignatureDocumentId(savedDocumentId);
        setPendingSubmit(true);
        setNotice('마지막으로 담당자 서명을 완료하면 자동으로 제출됩니다.');
        return;
      }
      await quickSign(savedDocumentId, 'author', () => undefined, undefined, revision);
      const signatureResponse = await api.signatures.getByDocument(savedDocumentId);
      setSignatures(signatureResponse.signatures);
      await api.documents.submit(savedDocumentId);
      saveExpenseAccountDefaults(user?.id || '', form);
      setNotice('제출했습니다.');
      if (!routeId) navigate(`/expense-receipts/${savedDocumentId}`, { replace: true });
      await loadDocument(savedDocumentId);
    } catch (error) {
      setErrors([errorText(error, '지출결의서를 제출하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handleRevertApproval = async () => {
    if (busy) return;
    if (!confirm('최종승인을 되돌려 결재대기(제출) 상태로 복귀시킵니다.\n대표 직인·승인 기록이 제거됩니다.\n\n계속할까요?')) return;
    setBusy(true);
    setErrors([]);
    try {
      await api.documents.approveRevert(documentId);
      setNotice('최종승인을 되돌렸습니다. 결재대기 상태로 복귀했습니다.');
      await loadDocument(documentId);
    } catch (error) {
      setErrors([errorText(error, '승인을 되돌리지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!documentId || !canApprove || busy) return;
    if (!confirm('이 지출결의서를 승인하고 대표이사 직인을 반영하시겠습니까?')) return;
    setBusy(true);
    setErrors([]);
    try {
      await api.documents.approve(documentId, representativeStep?.id ? { step_id: representativeStep.id } : undefined);
      await loadDocument(documentId);
      setNotice('승인했습니다. 합본 PDF와 Drive 백업이 순차 처리됩니다. 잠시 후 결재관리 목록으로 이동합니다.');
      window.setTimeout(() => navigate('/expense-receipts/manage'), 1500);
    } catch (error) {
      setErrors([errorText(error, '승인하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!documentId || !canReject || !rejectReason.trim() || busy) return;
    setBusy(true);
    setErrors([]);
    try {
      await api.documents.reject(documentId, { step_id: representativeStep?.id, reason: rejectReason.trim() });
      setShowReject(false);
      setRejectReason('');
      await loadDocument(documentId);
      setNotice('반려했습니다. 작성자가 내용을 수정해 재제출할 수 있습니다. 잠시 후 결재관리 목록으로 이동합니다.');
      window.setTimeout(() => navigate('/expense-receipts/manage'), 1500);
    } catch (error) {
      setErrors([errorText(error, '반려하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!documentId || !doc || doc.author_id !== user?.id || busy) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setErrors(['취소 사유를 입력하세요.']);
      return;
    }
    if (!confirm('이 지출결의서의 취소를 신청하시겠습니까?')) return;
    setBusy(true);
    setErrors([]);
    try {
      await api.documents.cancelRequest(documentId, reason);
      setShowCancelRequest(false);
      setCancelReason('');
      await loadDocument(documentId);
      setNotice('취소 신청을 완료했습니다. 관리자 승인 후 취소 처리됩니다.');
    } catch (error) {
      setErrors([errorText(error, '취소를 신청하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handlePdfDownload = async () => {
    if (!documentId || busy) return;
    setBusy(true);
    try {
      await api.expenseReceipts.downloadPdf(documentId, `${form.draft_date || '지출'}-영수증-첨부-지출결의서.pdf`);
    } catch (error) {
      setErrors([errorText(error, '합본 PDF를 다운로드하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  const handleSignatureComplete = async () => {
    const signedDocumentId = signatureDocumentId;
    if (!signedDocumentId) return;
    const response = await api.signatures.getByDocument(signedDocumentId);
    setSignatures(response.signatures);
    setSignatureDocumentId('');
    setSignatureRevision(undefined);
    if (!pendingSubmit) {
      setNotice('담당자 서명을 완료했습니다.');
      return;
    }
    // 최종 제출 흐름에서 서명을 마지막에 그린 경우: 서명 직후 자동 제출한다.
    setPendingSubmit(false);
    setBusy(true);
    try {
      await api.documents.submit(signedDocumentId);
      saveExpenseAccountDefaults(user?.id || '', form);
      setNotice('서명과 제출을 완료했습니다.');
      if (!routeId) navigate(`/expense-receipts/${signedDocumentId}`, { replace: true });
      await loadDocument(signedDocumentId);
    } catch (error) {
      setErrors([errorText(error, '지출결의서를 제출하지 못했습니다.')]);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page-loading">영수증 첨부 지출결의서를 불러오는 중...</div>;

  const status = doc?.status || 'draft';
  const isCancelled = Boolean(doc?.cancelled || detail?.cancelled);
  const isCancelRequested = !isCancelled && Boolean(doc?.cancel_requested || detail?.cancel_requested);
  const effectiveStatus = isCancelled ? 'cancelled' : isCancelRequested ? 'cancel_requested' : status;
  const statusInfo = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.draft;
  const canRequestCancellation = Boolean(doc
    && doc.author_id === user?.id
    && !isCancelled
    && !isCancelRequested
    && (status === 'submitted' || status === 'approved'));
  const orderedReceiptCards = receiptOrder.map((orderItem) => {
    if (orderItem.kind === 'existing') {
      const attachment = attachmentById.get(orderItem.id);
      return attachment ? { orderItem, name: attachment.file_name, size: attachment.file_size, preview: previewUrls[attachment.id] || '', saved: true } : null;
    }
    const local = localByKey.get(orderItem.key);
    return local ? { orderItem, name: local.file.name, size: local.file.size, preview: local.previewUrl, saved: false } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className="page expense-receipt-page">
      <header className="expense-receipt-page-header">
        <div>
          <button type="button" className="btn btn-sm expense-receipt-back" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/expense-receipts/manage'); }}>← 뒤로</button>
          <h2><Receipt size={24} /> 영수증 첨부 지출결의서</h2>
          <p>지출 내용과 영수증 원본을 한 번에 제출하면 승인 후 합본 PDF로 보관됩니다.</p>
        </div>
        <div className="expense-receipt-header-actions">
          <span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span>
          {savedAt && <small>저장 {savedAt.toLocaleTimeString('ko-KR')}</small>}
          {editable && (
            <button type="button" className="btn" onClick={handleSaveDraft} disabled={uiBusy}>
              <Save size={15} /> 임시저장
            </button>
          )}
          {editable && (
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={uiBusy}>
              <FileCheck2 size={15} /> {status === 'rejected' ? '수정 후 재제출' : '최종 제출'}
            </button>
          )}
          {detail?.artifact?.download_url && (
            <button type="button" className="btn" onClick={handlePdfDownload} disabled={busy}>
              <Download size={15} /> 합본 PDF
            </button>
          )}
          {canRequestCancellation && (
            <button type="button" className="btn btn-danger" onClick={() => setShowCancelRequest(true)} disabled={busy}>
              취소 신청
            </button>
          )}
        </div>
      </header>

      {errors.length > 0 && (
        <div className="alert alert-error expense-receipt-error" role="alert">
          <AlertTriangle size={18} />
          <div><strong>확인해 주세요.</strong><ul>{errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div>
        </div>
      )}
      {notice && <div className="alert alert-success"><Check size={17} /> {notice}</div>}
      {status === 'rejected' && doc?.reject_reason && (
        <div className="alert alert-error"><AlertTriangle size={17} /> 반려 사유: {doc.reject_reason}</div>
      )}
      {isCancelled && (
        <div className="alert" style={{ background: '#f1f3f4', color: '#5f6368', borderColor: '#dadce0' }}>
          <AlertTriangle size={17} /> 이 지출결의서는 취소 처리되었습니다. {(doc?.cancel_reason || detail?.cancel_reason) && <>사유: {doc?.cancel_reason || detail?.cancel_reason}</>}
        </div>
      )}
      {isCancelRequested && (
        <div className="alert" style={{ background: '#fff8e1', color: '#e65100', borderColor: '#ffcc02' }}>
          <AlertTriangle size={17} /> 취소 신청 중입니다. 사유: {doc?.cancel_reason || detail?.cancel_reason || '없음'}
        </div>
      )}

      <section className="expense-receipt-approval-card" aria-label="결재 현황">
        <div className="expense-receipt-approval-title"><ShieldCheck size={18} /> {isCancelled || isCancelRequested ? '결재 이력' : '결재'}</div>
        <div className="expense-receipt-approval-flow">
          <article className={`expense-receipt-approval-slot ${authorSignature ? 'done' : ''}`}>
            <span>담당자</span>
            <strong>{form.author_name || doc?.author_name || user?.name || '-'}</strong>
            {authorSignature ? (
              <><img src={authorSignature.signature_data} alt="담당자 서명" /><small>{formatExpenseReceiptDateTime(authorSignature.signed_at)}</small></>
            ) : <small>{editable ? '최종 제출 시 자동 서명' : '서명 대기'}</small>}
          </article>
          <ArrowRight className="expense-receipt-approval-arrow" size={22} />
          <article className={`expense-receipt-approval-slot ${status === 'approved' ? 'done' : status === 'rejected' ? 'rejected' : ''}`}>
            <span>대표이사</span>
            {status === 'approved' ? <img src="/LNCstemp.png" alt="대표이사 직인" /> : <strong>{status === 'rejected' ? '반려' : '직인 대기'}</strong>}
            {approvalAction && (
              <small>실제 {approvalAction.action === 'approved' ? '승인' : '반려'}: {approvalAction.actor_name} ({approvalAction.actor_role})<br />{formatExpenseReceiptDateTime(approvalAction.created_at)}</small>
            )}
          </article>
        </div>
        {status === 'submitted' && !isCancelled && !isCancelRequested && (canApprove || canReject) && (
          <div className="expense-receipt-approval-actions">
            {canReject && <button type="button" className="btn btn-danger" onClick={() => setShowReject(true)} disabled={busy}>반려</button>}
            {canApprove && <button type="button" className="btn btn-success" onClick={handleApprove} disabled={busy}>승인</button>}
          </div>
        )}
        {status === 'approved' && !isCancelled && !isCancelRequested && canRevertApproval && (
          <div className="expense-receipt-approval-actions">
            <button type="button" className="btn btn-danger" onClick={handleRevertApproval} disabled={busy}>승인 되돌리기</button>
          </div>
        )}
      </section>

      <section className="expense-receipt-form-card">
        <div className="expense-receipt-form-heading">
          <div><span>지출결의 기본정보</span><small>* 표시는 제출 전 필수입니다.</small></div>
          {!editable && <span className="expense-receipt-readonly">제출 후에는 내용을 변경할 수 없습니다.</span>}
        </div>
        <div className="expense-receipt-basic-grid">
          <label><span>기안일 *</span><input type="date" className="form-input" value={form.draft_date} onChange={(event) => updateForm('draft_date', event.target.value)} disabled={!editable} /></label>
          <label><span>기안자</span><input className="form-input" value={form.author_name} readOnly aria-readonly="true" /></label>
          <label><span>부서</span><input className="form-input" value={form.department || '-'} readOnly aria-readonly="true" /></label>
          <label><span>직급</span><input className="form-input" value={form.position_title || '-'} readOnly aria-readonly="true" /></label>
          <label className="expense-receipt-purpose"><span>지출 목적 *</span><textarea className="form-input" rows={3} value={form.purpose} onChange={(event) => updateForm('purpose', event.target.value)} disabled={!editable} maxLength={500} placeholder="업무상 지출 목적을 구체적으로 입력하세요." /></label>
          <label><span>지급 방법 *</span><select className="form-input" value={form.payment_method} onChange={(event) => updateForm('payment_method', event.target.value)} disabled={!editable}><option value="">선택</option>{EXPENSE_RECEIPT_PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label><span>사건번호</span><input className="form-input" value={form.case_number} onChange={(event) => updateForm('case_number', event.target.value)} disabled={!editable} maxLength={50} placeholder="예: 2026타경12345" /></label>
          <label><span>고객명</span><input className="form-input" value={form.client_name} onChange={(event) => updateForm('client_name', event.target.value)} disabled={!editable} maxLength={100} placeholder="고객명" /></label>
          <label><span>입금일</span><input type="date" className="form-input" value={form.deposit_date} onChange={(event) => updateForm('deposit_date', event.target.value)} disabled={!editable} /></label>
          <label><span>입금액</span><input className="form-input" inputMode="numeric" value={form.deposit_amount ? Number(form.deposit_amount).toLocaleString('ko-KR') : ''} onChange={(event) => updateForm('deposit_amount', event.target.value.replace(/[^\d]/g, ''))} disabled={!editable} placeholder="원" /></label>
          {editable && accountDefaults && (
            <div className="expense-receipt-account-recall" style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" onClick={applyAccountDefaults} disabled={uiBusy}>저장된 계좌정보 불러오기</button>
              <small style={{ color: '#667085' }}>이전에 저장한 은행·계좌번호·예금주·비고를 채웁니다.</small>
            </div>
          )}
          <label><span>은행명</span><input className="form-input" value={form.bank_name} onChange={(event) => updateForm('bank_name', event.target.value)} disabled={!editable} maxLength={50} placeholder="예: 국민은행" /></label>
          <label><span>계좌번호</span><input className="form-input" value={form.account_number} onChange={(event) => updateForm('account_number', event.target.value)} disabled={!editable} maxLength={50} placeholder="- 포함 입력 가능" /></label>
          <label><span>예금주</span><input className="form-input" value={form.account_holder} onChange={(event) => updateForm('account_holder', event.target.value)} disabled={!editable} maxLength={50} placeholder="예금주명" /></label>
          <label className="expense-receipt-purpose"><span>비고 (결제 지급 계좌)</span><textarea className="form-input" rows={2} value={form.account_note} onChange={(event) => updateForm('account_note', event.target.value)} disabled={!editable} maxLength={500} placeholder="결제 지급 계좌 관련 비고" /></label>
        </div>

        <div className="expense-receipt-items-head">
          <div><h3>지출 내역</h3><p>기본 3개 행이 제공되며 필요하면 행을 추가할 수 있습니다.</p></div>
          {editable && <button type="button" className="btn btn-sm" onClick={addItem}><Plus size={14} /> 행 추가</button>}
        </div>
        <div className="expense-receipt-items" role="table" aria-label="지출 내역">
          <div className="expense-receipt-item-row header" role="row"><span>No.</span><span>항목 *</span><span>금액 *</span><span>비고</span><span>관리</span></div>
          {form.items.map((item, index) => (
            <div className="expense-receipt-item-row" role="row" key={item.id}>
              <span className="expense-receipt-item-number">{index + 1}</span>
              <label><span>항목</span><input className="form-input" value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} disabled={!editable} maxLength={150} placeholder="지출 항목" /></label>
              <label><span>금액</span><div className="expense-receipt-amount-input"><input className="form-input" inputMode="numeric" value={item.amount ? Number(item.amount).toLocaleString('ko-KR') : ''} onChange={(event) => updateItem(index, 'amount', event.target.value)} disabled={!editable} placeholder="0" /><span>원</span></div></label>
              <label><span>비고</span><input className="form-input" value={item.note} onChange={(event) => updateItem(index, 'note', event.target.value)} disabled={!editable} maxLength={200} placeholder="선택 입력" /></label>
              <div className="expense-receipt-item-actions">
                {editable && <button type="button" className="btn-icon-sm" onClick={() => removeItem(index)} disabled={form.items.length <= 3} aria-label={`${index + 1}번 지출 항목 삭제`}><Trash2 size={15} /></button>}
              </div>
            </div>
          ))}
          <div className="expense-receipt-total"><span>합계</span><strong>{formatWon(total)}</strong></div>
        </div>
      </section>

      <section className="expense-receipt-upload-card">
        <div className="expense-receipt-upload-head">
          <div><h3>영수증 이미지 <em>최소 1장 필수</em></h3><p>승인 후 지출결의서와 아래 순서대로 합본 PDF가 생성됩니다.</p></div>
          <span>{receiptOrder.length}/{EXPENSE_RECEIPT_MAX_FILES}장 · {formatExpenseReceiptBytes(totalReceiptBytes)}/40MB</span>
        </div>
        {editable && (
          <div
            className={`expense-receipt-dropzone ${dragActive ? 'active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
            onDrop={handleDrop}
          >
            <ImagePlus size={30} />
            <strong>영수증을 끌어 놓거나 사진앨범에서 선택하세요.</strong>
            <span>JPG·PNG·WEBP · 최대 10장 · 파일당 10MB · 전체 40MB</span>
            <span className="expense-receipt-heic-notice">큰 사진은 자동 최적화하며, HEIC/HEIF도 브라우저에서 열 수 있으면 JPG로 자동 변환합니다. 변환 안내가 나오면 JPG 또는 스크린샷으로 첨부해 주세요.</span>
            <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uiBusy}>{preparingFiles ? '사진 최적화 중…' : '사진 선택'}</button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileInput} className="expense-receipt-file-input" />
          </div>
        )}

        {orderedReceiptCards.length > 0 ? (
          <div className="expense-receipt-preview-grid">
            {orderedReceiptCards.map((card, index) => (
              <article
                className="expense-receipt-preview-card"
                key={card.orderItem.kind === 'existing' ? card.orderItem.id : card.orderItem.key}
                draggable={editable && !uiBusy}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); if (dragIndex !== null) moveReceipt(dragIndex, index); setDragIndex(null); }}
              >
                <div className="expense-receipt-preview-image">
                  {card.preview ? (
                    <img
                      src={card.preview}
                      alt={`${index + 1}번 영수증 미리보기`}
                      style={{ cursor: 'zoom-in' }}
                      title="클릭하면 크게 봅니다"
                      onClick={() => setLightbox({ url: card.preview, name: card.name })}
                    />
                  ) : <div>미리보기<br />불러오기 실패</div>}
                  <span>{index + 1}</span>
                  {!card.saved && <small>저장 대기</small>}
                </div>
                <div className="expense-receipt-preview-info"><strong title={card.name}>{card.name}</strong><span>{formatExpenseReceiptBytes(card.size)}</span></div>
                {editable && (
                  <div className="expense-receipt-preview-actions">
                    <GripVertical size={16} aria-hidden="true" />
                    <button type="button" onClick={() => moveReceipt(index, index - 1)} disabled={index === 0 || uiBusy} aria-label="앞으로 이동"><ArrowLeft size={15} /><ArrowUp size={15} /></button>
                    <button type="button" onClick={() => moveReceipt(index, index + 1)} disabled={index === orderedReceiptCards.length - 1 || uiBusy} aria-label="뒤로 이동"><ArrowRight size={15} /><ArrowDown size={15} /></button>
                    <button type="button" className="danger" onClick={() => removeReceipt(card.orderItem)} disabled={uiBusy} aria-label="영수증 삭제"><Trash2 size={15} /></button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="expense-receipt-empty-receipts">{detail?.site_purged ? '승인 후 30일 보관기간이 지나 사이트 원본이 정리되었습니다. 합본 PDF는 Drive에서 보관됩니다.' : '첨부된 영수증이 없습니다.'}</div>
        )}
      </section>

      {doc && (
        <section className="expense-receipt-storage-card">
          <h3><Cloud size={18} /> 합본 PDF·Drive·30일 정리 상태</h3>
          <div className="expense-receipt-storage-grid">
            <div><span>합본 PDF</span><strong>{detail?.artifact ? '생성 완료' : status === 'approved' ? '생성 중' : '승인 후 생성'}</strong>{detail?.artifact && <small>{detail.artifact.file_name} · {formatExpenseReceiptBytes(detail.artifact.file_size)}</small>}</div>
            <div><span>Google Drive</span><strong>{detail?.drive_status === 'success' ? '백업 완료' : detail?.drive_status === 'failed' ? '백업 실패' : '백업 대기'}</strong><small>{detail?.artifact?.drive_folder_path || detail?.drive_error || '-'}</small>{detail?.artifact?.drive_file_id && <a className="btn btn-sm expense-receipt-drive-link" href={`https://drive.google.com/file/d/${encodeURIComponent(detail.artifact.drive_file_id)}/view`} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Drive에서 열기</a>}</div>
            <div><span>사이트 원본 30일 정리</span><strong>{detail?.site_purged ? '정리 완료' : detail?.retention_eligible_at ? '정리 예정' : '승인 후 산정'}</strong><small>{detail?.site_purged ? formatExpenseReceiptDateTime(detail?.artifact?.purged_at) : formatExpenseReceiptDateTime(detail?.retention_eligible_at)}</small></div>
            <div><span>실제 승인자</span><strong>{detail?.actual_approver_name || approvalAction?.actor_name || '-'}</strong><small>{detail?.actual_approver_role || approvalAction?.actor_role || ''}</small></div>
          </div>
        </section>
      )}

      {showReject && (
        <div className="modal-overlay" onClick={() => !busy && setShowReject(false)}>
          <section className="modal expense-receipt-reject-modal" role="dialog" aria-modal="true" aria-labelledby="expense-receipt-reject-title" onClick={(event) => event.stopPropagation()}>
            <div className="expense-receipt-reject-head"><h3 id="expense-receipt-reject-title">지출결의서 반려</h3><button type="button" className="modal-close" onClick={() => setShowReject(false)} disabled={busy} aria-label="닫기"><X size={18} /></button></div>
            <label><span>반려 사유 *</span><textarea className="form-input" rows={4} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} placeholder="작성자가 수정할 내용을 구체적으로 입력하세요." autoFocus /></label>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setShowReject(false)} disabled={busy}>취소</button><button type="button" className="btn btn-danger" onClick={handleReject} disabled={busy || !rejectReason.trim()}>반려</button></div>
          </section>
        </div>
      )}

      {showCancelRequest && (
        <div className="modal-overlay" onClick={() => !busy && setShowCancelRequest(false)}>
          <section className="modal expense-receipt-reject-modal" role="dialog" aria-modal="true" aria-labelledby="expense-receipt-cancel-title" onClick={(event) => event.stopPropagation()}>
            <div className="expense-receipt-reject-head"><h3 id="expense-receipt-cancel-title">지출결의서 취소 신청</h3><button type="button" className="modal-close" onClick={() => setShowCancelRequest(false)} disabled={busy} aria-label="닫기"><X size={18} /></button></div>
            <p>관리자가 승인하면 이 지출결의서는 취소 처리됩니다.</p>
            <label><span>취소 사유 *</span><textarea className="form-input" rows={4} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={500} placeholder="취소 사유를 구체적으로 입력하세요." autoFocus /></label>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setShowCancelRequest(false)} disabled={busy}>닫기</button><button type="button" className="btn btn-danger" onClick={handleCancelRequest} disabled={busy || !cancelReason.trim()}>취소 신청</button></div>
          </section>
        </div>
      )}

      {lightbox && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setLightbox(null)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ position: 'relative', maxWidth: '94vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, color: '#fff' }}>
              <strong style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lightbox.name}</strong>
              <button type="button" className="btn btn-sm" onClick={() => setLightbox(null)} aria-label="닫기"><X size={16} /> 닫기</button>
            </div>
            <img
              src={lightbox.url}
              alt={lightbox.name}
              style={{ maxWidth: '94vw', maxHeight: '84vh', objectFit: 'contain', borderRadius: 8, background: '#fff' }}
            />
          </div>
        </div>
      )}

      {signatureDocumentId && (
        <SignaturePanel
          documentId={signatureDocumentId}
          signatureType="author"
          expenseReceiptRevision={signatureRevision}
          onClose={() => { setSignatureDocumentId(''); setSignatureRevision(undefined); setPendingSubmit(false); }}
          onSign={handleSignatureComplete}
        />
      )}
    </div>
  );
}
