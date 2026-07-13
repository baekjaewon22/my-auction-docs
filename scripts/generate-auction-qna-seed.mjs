import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'qna', '경매사례.md');
const outputPath = path.join(root, 'd1', 'seed-auction-qna-20260713.sql');
const markdown = fs.readFileSync(sourcePath, 'utf8');
const heading = /^## (Q\d+)\.\s+(.+)$/gm;
const matches = [...markdown.matchAll(heading)];

function field(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`^- \\*\\*${escaped}\\*\\*:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
}

function section(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`\\*\\*${escaped}\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[^\\n]+\\*\\*|\\n---|$)`))?.[1]?.trim() || '';
}

function sql(value) {
  return `'${String(value || '').replaceAll("'", "''")}'`;
}

function timestamp(index, answer = false) {
  const date = new Date(Date.UTC(2026, 3, 25 + index, answer ? 5 : 2, (index * 17) % 60));
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const rows = matches.map((match, index) => {
  const start = (match.index || 0) + match[0].length;
  const end = matches[index + 1]?.index ?? markdown.length;
  const block = markdown.slice(start, end);
  return {
    id: match[1],
    title: match[2].trim(),
    category: field(block, '카테고리'),
    keywords: field(block, '키워드'),
    difficulty: field(block, '난이도'),
    situation: section(block, '상황'),
    answer: section(block, '답변'),
    checklist: section(block, '핵심 체크'),
    basis: section(block, '근거'),
  };
});

const statements = [
  '-- qna/경매사례.md의 80개 사례를 법률지원 > 경매에 익명 질문/답변으로 등록합니다.',
  '-- 고정 ID와 INSERT OR IGNORE를 사용하므로 여러 번 실행해도 중복 생성되지 않습니다.',
];

for (const [index, row] of rows.entries()) {
  const noteId = `auction-qna-${row.id.toLowerCase()}`;
  const commentId = `auction-qna-answer-${row.id.toLowerCase()}`;
  const content = [
    row.situation,
    '',
    `[분류] ${row.category}`,
    `[난이도] ${row.difficulty}`,
    `[검색어] ${row.keywords}`,
    '',
    '관련 경험이나 추가로 확인할 사항이 있다면 답변으로 남겨주세요.',
  ].join('\n').trim();
  const answer = [
    row.answer,
    row.checklist ? `\n\n[핵심 체크]\n${row.checklist}` : '',
    row.basis ? `\n\n[참고 근거]\n${row.basis}` : '',
    '\n\n※ 교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.',
  ].join('').trim();
  statements.push(`
INSERT OR IGNORE INTO admin_notes (
  id, title, content, author_id, author_name, pinned, source_type, source_id,
  is_anonymous, visibility, author_branch, author_department, category,
  court, case_number, legal_subcategory, lawsuit_cost_requested, view_count,
  created_at, updated_at
)
SELECT
  ${sql(noteId)}, ${sql(row.title)}, ${sql(content)}, u.id, '익명', 0,
  'auction_qna_md', ${sql(row.id)}, 1, 'all', COALESCE(u.branch, ''),
  COALESCE(u.department, ''), 'legal_support', '교육사례', ${sql(row.id)},
  'auction', 0, 0, ${sql(timestamp(index))}, ${sql(timestamp(index))}
FROM users u
WHERE COALESCE(u.approved, 0) = 1
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;

INSERT OR IGNORE INTO admin_note_comments (
  id, note_id, author_id, author_name, content, is_anonymous, created_at
)
SELECT
  ${sql(commentId)}, ${sql(noteId)}, u.id, '법률지원팀', ${sql(answer)}, 0, ${sql(timestamp(index, true))}
FROM users u
WHERE COALESCE(u.approved, 0) = 1
  AND EXISTS (SELECT 1 FROM admin_notes n WHERE n.id = ${sql(noteId)})
ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at
LIMIT 1;`);
}

statements.push(`-- generated cases: ${rows.length}`);
fs.writeFileSync(outputPath, `${statements.join('\n')}\n`, 'utf8');
console.log(`Generated ${outputPath} (${rows.length} cases)`);
