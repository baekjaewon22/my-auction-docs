export function appendFrameAncestorsDirective(
  existingCsp: string,
  frameAncestorsDirective: string,
): string {
  const existing = String(existingCsp || '').trim();
  if (/(?:^|;)\s*frame-ancestors\s+/i.test(existing)) {
    return existing;
  }

  const directive = String(frameAncestorsDirective || '').trim();
  if (!existing) return directive;
  return `${existing.replace(/;?\s*$/, ';')} ${directive}`;
}
