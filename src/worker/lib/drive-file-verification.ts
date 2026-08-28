/**
 * Confirm that an app-created Drive file still exists and has not been moved
 * to trash. Callers intentionally treat every thrown error as "not verified"
 * so retention always fails closed.
 */
export async function driveFileStillExists(
  accessToken: string,
  fileId: string,
  expectedSize?: number,
  expectedMd5Checksum?: string,
  expectedSha256?: string,
): Promise<boolean> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id%2Ctrashed%2Csize%2Cmd5Checksum`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Drive 파일 확인 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const metadata = await response.json<{ id?: string; trashed?: boolean; size?: string; md5Checksum?: string }>();
  if (metadata.id !== fileId || metadata.trashed === true) return false;
  if (expectedSize !== undefined && Number(metadata.size) !== expectedSize) return false;

  const normalizedMd5 = String(expectedMd5Checksum || '').trim().toLowerCase();
  if (normalizedMd5) {
    return String(metadata.md5Checksum || '').trim().toLowerCase() === normalizedMd5;
  }

  // Artifacts produced before drive_md5_checksum was introduced still carry
  // the site's SHA-256. Download that exact Drive file once and compare bytes
  // before retention. A size-only match is intentionally not sufficient.
  const normalizedSha256 = String(expectedSha256 || '').trim().toLowerCase();
  if (!normalizedSha256) return false;
  const contentResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!contentResponse.ok) {
    throw new Error(`Drive 파일 원문 확인 실패 (${contentResponse.status}): ${(await contentResponse.text()).slice(0, 300)}`);
  }
  const digest = await crypto.subtle.digest('SHA-256', await contentResponse.arrayBuffer());
  const actualSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return actualSha256 === normalizedSha256;
}
