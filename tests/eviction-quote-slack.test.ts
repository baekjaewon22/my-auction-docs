import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evictionQuoteSlackWebhookSource,
  renderEvictionQuoteSlackMessage,
} from '../src/worker/lib/eviction-quote-slack.ts';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRET';

test('명도 전용 Slack Webhook을 가장 먼저 사용한다', () => {
  assert.equal(evictionQuoteSlackWebhookSource({
    SLACK_EVICTION_QUOTE_WEBHOOK_URL: WEBHOOK,
    SLACK_ACCOUNTING_WEBHOOK_URL: WEBHOOK + '-accounting',
  }), 'SLACK_EVICTION_QUOTE_WEBHOOK_URL');
});

test('명도 전용 Webhook이 없으면 현재 운영 Slack Webhook을 사용한다', () => {
  assert.equal(evictionQuoteSlackWebhookSource({
    SLACK_ACCOUNTING_WEBHOOK_URL: WEBHOOK,
    SLACK_ROOM_RESERVATION_WEBHOOK_URL: WEBHOOK + '-room',
  }), 'SLACK_ACCOUNTING_WEBHOOK_URL');
});

test('명도견적 Slack 메시지에 사건 정보와 게시글 링크를 포함한다', () => {
  const message = renderEvictionQuoteSlackMessage({
    noteId: 'note-123',
    authorName: '홍길동',
    court: '의정부지방법원',
    caseNumber: '2026타경1234',
    title: '의정부지방법원 2026타경1234 명도 견적 의뢰',
  });
  assert.match(message, /홍길동/);
  assert.match(message, /의정부지방법원/);
  assert.match(message, /2026타경1234/);
  assert.match(message, /tab=eviction_quote&note=note-123/);
});
