export const MAX_NOTICE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_NOTICE_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;
// D1 has a 2,000,000-byte value/row ceiling. A 1 MiB binary expands to about
// 1.4 MiB as base64, leaving room for the data-URL prefix and row metadata.
export const MAX_NOTICE_D1_ATTACHMENT_BYTES = 1024 * 1024;

const ACTIVE_CONTENT_TYPES = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
]);

export type DecodedDataUrl = {
  buffer: ArrayBuffer;
  contentType: string;
};

export type NormalizedNoticeAttachment = {
  file_name: string;
  file_type: string;
  file_size: number;
  file_data: string;
  decoded_buffer: ArrayBuffer;
};

export class NoticeAttachmentValidationError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = 'NoticeAttachmentValidationError';
    this.status = status;
  }
}

function normalizeContentType(value: unknown): string {
  return String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase() || 'application/octet-stream';
}

export function decodeAttachmentDataUrl(dataUrl: string, maxBytes = Number.POSITIVE_INFINITY): DecodedDataUrl | null {
  const match = String(dataUrl || '').match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!match) return null;

  const contentType = normalizeContentType(match[1]);
  const isBase64 = !!match[2];
  const payload = match[3] || '';

  try {
    let bytes: Uint8Array;
    if (isBase64) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1) return null;
      const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
      const estimatedBytes = Math.floor(payload.length * 3 / 4) - padding;
      if (estimatedBytes > maxBytes) {
        throw new NoticeAttachmentValidationError('첨부파일 하나는 10MB를 넘을 수 없습니다.', 413);
      }
      const binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
      if (bytes.byteLength > maxBytes) {
        throw new NoticeAttachmentValidationError('첨부파일 하나는 10MB를 넘을 수 없습니다.', 413);
      }
    }
    return { buffer: bytes.buffer, contentType };
  } catch (error) {
    if (error instanceof NoticeAttachmentValidationError) throw error;
    return null;
  }
}

export function hasPdfSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 5) return false;
  return new TextDecoder().decode(buffer.slice(0, 5)) === '%PDF-';
}

export function isPdfAttachmentMetadata(file: { file_name?: unknown; file_type?: unknown }): boolean {
  return normalizeContentType(file.file_type) === 'application/pdf' || /\.pdf$/i.test(String(file.file_name || '').trim());
}

export function normalizeNoticeAttachments(rawAttachments: unknown[]): NormalizedNoticeAttachment[] {
  let totalBytes = 0;
  return rawAttachments.map((raw, index) => {
    const file = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const fileName = String(file.file_name || '').trim();
    const fileData = String(file.file_data || '');
    if (!fileName || !fileData) {
      throw new NoticeAttachmentValidationError(`${index + 1}번째 첨부파일 정보가 올바르지 않습니다.`);
    }

    const parsed = decodeAttachmentDataUrl(fileData, MAX_NOTICE_ATTACHMENT_BYTES);
    if (!parsed) throw new NoticeAttachmentValidationError(`${fileName}: 첨부파일 데이터를 읽을 수 없습니다.`);

    const declaredType = normalizeContentType(file.file_type);
    const isPdf = isPdfAttachmentMetadata(file) || parsed.contentType === 'application/pdf';
    if (isPdf && !hasPdfSignature(parsed.buffer)) {
      throw new NoticeAttachmentValidationError(`${fileName}: 실제 PDF 파일만 PDF로 첨부할 수 있습니다.`);
    }
    if (!isPdf && (ACTIVE_CONTENT_TYPES.has(declaredType) || ACTIVE_CONTENT_TYPES.has(parsed.contentType))) {
      throw new NoticeAttachmentValidationError(`${fileName}: 실행 가능한 웹 문서 형식은 첨부할 수 없습니다.`);
    }
    if (!isPdf && parsed.buffer.byteLength > MAX_NOTICE_D1_ATTACHMENT_BYTES) {
      throw new NoticeAttachmentValidationError(`${fileName}: PDF 외 첨부파일은 1MB를 넘을 수 없습니다.`, 413);
    }

    totalBytes += parsed.buffer.byteLength;
    if (totalBytes > MAX_NOTICE_ATTACHMENTS_TOTAL_BYTES) {
      throw new NoticeAttachmentValidationError('공지사항 첨부파일 합계는 20MB를 넘을 수 없습니다.', 413);
    }

    return {
      file_name: fileName,
      file_type: isPdf ? 'application/pdf' : declaredType,
      file_size: parsed.buffer.byteLength,
      file_data: fileData,
      decoded_buffer: parsed.buffer,
    };
  });
}

export function noticePdfResponseHeaders(fileName: string, byteLength: number): Record<string, string> {
  return {
    'Content-Type': 'application/pdf',
    'Content-Length': String(byteLength),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function noticePdfDownloadResponseHeaders(fileName: string, byteLength: number): Record<string, string> {
  return {
    ...noticePdfResponseHeaders(fileName, byteLength),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  };
}
