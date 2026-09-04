export const ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function assertPdfSignature(bytes: Uint8Array): void {
  if (bytes.length < PDF_SIGNATURE.length || PDF_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('PDF 형식이 올바르지 않습니다.');
  }
}

function assertPdfSize(size: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new Error('PDF 파일이 비어 있습니다.');
  if (size > ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES) throw new Error('10MB 이하 PDF만 바로 볼 수 있습니다.');
}

export async function assertSafeAdminNotePdfBlob(blob: Blob): Promise<void> {
  assertPdfSize(blob.size);
  const signature = new Uint8Array(await blob.slice(0, PDF_SIGNATURE.length).arrayBuffer());
  assertPdfSignature(signature);
}

export function safeAdminNotePdfDataUrlBlob(value: string): Blob {
  const match = /^data:application\/pdf((?:;[^,]*)?),(.*)$/is.exec(value);
  if (!match) throw new Error('PDF 파일 주소가 올바르지 않습니다.');
  const parameters = match[1] || '';
  const payload = match[2] || '';

  if (/;base64(?:;|$)/i.test(parameters)) {
    const encoded = payload.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
      throw new Error('PDF 파일 인코딩이 올바르지 않습니다.');
    }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const decodedSize = Math.floor(encoded.length * 3 / 4) - padding;
    assertPdfSize(decodedSize);
    let decoded = '';
    try {
      decoded = atob(encoded);
    } catch {
      throw new Error('PDF 파일 인코딩이 올바르지 않습니다.');
    }
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    assertPdfSignature(bytes);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  if (payload.length > ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES * 3) {
    throw new Error('10MB 이하 PDF만 바로 볼 수 있습니다.');
  }
  const decodedBuffer = new Uint8Array(Math.min(payload.length, ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES + 1));
  let decodedSize = 0;
  for (let index = 0; index < payload.length; index += 1) {
    if (decodedSize >= ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES) throw new Error('10MB 이하 PDF만 바로 볼 수 있습니다.');
    if (payload[index] === '%') {
      const encodedByte = payload.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(encodedByte)) throw new Error('PDF 파일 인코딩이 올바르지 않습니다.');
      decodedBuffer[decodedSize] = Number.parseInt(encodedByte, 16);
      decodedSize += 1;
      index += 2;
      continue;
    }
    const character = payload.charCodeAt(index);
    if (character > 0x7f) throw new Error('PDF 파일 인코딩이 올바르지 않습니다.');
    decodedBuffer[decodedSize] = character;
    decodedSize += 1;
  }
  const bytes = decodedBuffer.slice(0, decodedSize);
  assertPdfSize(bytes.byteLength);
  assertPdfSignature(bytes.subarray(0, PDF_SIGNATURE.length));
  return new Blob([bytes], { type: 'application/pdf' });
}
