import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('대전지방법원 공주지원이 공용 법원 선택지에 포함된다', () => {
  const types = readFileSync('src/react-app/journal/types.ts', 'utf8');
  assert.match(types, /main: '대전지방법원', branches: \['공주지원', '홍성지원', '논산지원', '천안지원', '서산지원'\]/);
  assert.match(types, /value: `\$\{c\.main\} \$\{b\}`/);
});

test('일정등록과 모든 공용 법원 선택 화면은 같은 법원 목록을 사용한다', () => {
  const journalForm = readFileSync('src/react-app/journal/JournalForm.tsx', 'utf8');
  const adminNotes = readFileSync('src/react-app/pages/AdminNotes.tsx', 'utf8');
  const cooperation = readFileSync('src/react-app/pages/Cooperation.tsx', 'utf8');

  assert.match(journalForm, /COURT_OPTIONS/);
  assert.match(adminNotes, /COURTS as ALL_COURTS/);
  assert.match(cooperation, /import \{ COURTS \} from '\.\.\/journal\/types'/);
});
