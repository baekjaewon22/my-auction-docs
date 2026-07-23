export function signatureDisplayName(signature: {
  user_name?: string | null;
  user_email?: string | null;
}): string {
  return String(signature.user_name || signature.user_email || '').trim() || '탈퇴 사용자';
}
