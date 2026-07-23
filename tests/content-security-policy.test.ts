import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFrameAncestorsDirective } from '../src/shared/content-security-policy.ts';

test('기존 CSP 뒤에 frame-ancestors를 독립 지시문으로 추가한다', () => {
  assert.equal(
    appendFrameAncestorsDirective(
      "default-src 'self'; form-action 'none'",
      "frame-ancestors 'self';",
    ),
    "default-src 'self'; form-action 'none'; frame-ancestors 'self';",
  );
});

test('응답이 더 엄격한 frame-ancestors를 이미 선언하면 덮어쓰지 않는다', () => {
  const callbackCsp = "default-src 'none'; frame-ancestors 'none'; form-action 'none'";
  assert.equal(
    appendFrameAncestorsDirective(callbackCsp, "frame-ancestors 'self';"),
    callbackCsp,
  );
});
