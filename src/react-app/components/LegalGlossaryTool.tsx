import { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import Select from './Select';
import glossaryMarkdown from '../../../qna/용어사전.md?raw';

type GlossaryTerm = {
  id: string;
  term: string;
  category: string;
  synonyms: string;
  summary: string;
  description: string;
  example: string;
  caution: string;
  related: string;
};

function singleLine(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`^- \\*\\*${escaped}\\*\\*:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
}

function section(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`\\*\\*${escaped}\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[^\\n]+\\*\\*|\\n---|$)`))?.[1]?.trim() || '';
}

function parseGlossary(markdown: string): GlossaryTerm[] {
  const heading = /^## (T\d+)\.\s+(.+)$/gm;
  const matches = [...markdown.matchAll(heading)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    return {
      id: match[1],
      term: match[2].trim(),
      category: singleLine(block, '카테고리'),
      synonyms: singleLine(block, '동의어'),
      summary: singleLine(block, '한줄요약'),
      description: section(block, '설명'),
      example: section(block, '예시'),
      caution: section(block, '주의'),
      related: singleLine(block, '관련용어'),
    };
  });
}

const TERMS = parseGlossary(glossaryMarkdown);

export default function LegalGlossaryTool() {
  const [category, setCategory] = useState('전체');
  const [selectedId, setSelectedId] = useState(TERMS[0]?.id || '');
  const [inputText, setInputText] = useState('');
  const categories = useMemo(() => ['전체', ...Array.from(new Set(TERMS.map(item => item.category).filter(Boolean)))], []);
  const categoryTerms = useMemo(
    () => category === '전체' ? TERMS : TERMS.filter(item => item.category === category),
    [category],
  );
  const options = useMemo(() => categoryTerms.map(item => ({
    value: item.id,
    label: `${item.term}${item.summary ? ` · ${item.summary}` : ''}`,
  })), [categoryTerms]);
  const selected = TERMS.find(item => item.id === selectedId) || categoryTerms[0] || TERMS[0];

  const previewTypedTerm = (value: string) => {
    setInputText(value);
    const keyword = value.trim().toLowerCase();
    if (!keyword) return;
    const found = categoryTerms.find(item =>
      item.term.toLowerCase().includes(keyword)
      || item.synonyms.toLowerCase().includes(keyword)
      || item.summary.toLowerCase().includes(keyword),
    );
    if (found) setSelectedId(found.id);
  };

  return (
    <section className="card" style={{ padding: 22, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#e8f0fe', color: '#1a73e8' }}><BookOpen size={22} /></div>
        <div>
          <h3 style={{ margin: 0 }}>법원경매 용어사전</h3>
          <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: '0.82rem' }}>용어를 선택하거나 직접 입력하면 설명을 바로 미리 볼 수 있습니다.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 0.35fr) minmax(280px, 1.65fr)', gap: 10, marginBottom: 12 }}>
        <select className="form-input" value={category} onChange={(event) => {
          const next = event.target.value;
          setCategory(next);
          const first = next === '전체' ? TERMS[0] : TERMS.find(item => item.category === next);
          if (first) setSelectedId(first.id);
        }}>
          {categories.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <Select
          options={options}
          value={options.find(option => option.value === selected?.id) || null}
          onChange={(option: any) => option?.value && setSelectedId(option.value)}
          onInputChange={(value, meta) => {
            if (meta.action === 'input-change') previewTypedTerm(value);
          }}
          inputValue={inputText}
          onMenuClose={() => setInputText('')}
          placeholder="용어를 선택하거나 직접 입력하세요"
          isSearchable
          filterOption={(candidate, value) => {
            const term = TERMS.find(item => item.id === candidate.value);
            const keyword = value.trim().toLowerCase();
            if (!keyword) return true;
            return !!term && `${term.term} ${term.synonyms} ${term.summary}`.toLowerCase().includes(keyword);
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5f6368', fontSize: '0.78rem', marginBottom: 16 }}>
        <Search size={14} /> 총 {TERMS.length}개 용어 · 선택 목록과 텍스트 검색을 함께 지원합니다.
      </div>

      {selected && (
        <article style={{ border: '1px solid #dfe6ef', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
          <header style={{ padding: '18px 20px', background: 'linear-gradient(135deg, #f6f9ff, #eef5ff)', borderBottom: '1px solid #dfe6ef' }}>
            <div style={{ color: '#1a73e8', fontSize: '0.76rem', fontWeight: 700 }}>{selected.category} · {selected.id}</div>
            <h2 style={{ margin: '5px 0 6px', fontSize: '1.35rem' }}>{selected.term}</h2>
            <p style={{ margin: 0, color: '#334155', lineHeight: 1.65 }}>{selected.summary}</p>
          </header>
          <div style={{ display: 'grid', gap: 16, padding: 20 }}>
            {selected.synonyms && selected.synonyms !== '—' && <GlossaryRow label="비슷한 말" text={selected.synonyms} />}
            <GlossaryRow label="설명" text={selected.description} />
            {selected.example && <GlossaryRow label="예시" text={selected.example} />}
            {selected.caution && <GlossaryRow label="주의" text={selected.caution} tone="warning" />}
            {selected.related && <GlossaryRow label="관련용어" text={selected.related} />}
          </div>
        </article>
      )}
      <p style={{ margin: '14px 0 0', color: '#7c8594', fontSize: '0.74rem' }}>교육용 자료이며 개별 사건의 법률적 판단을 대체하지 않습니다.</p>
    </section>
  );
}

function GlossaryRow({ label, text, tone }: { label: string; text: string; tone?: 'warning' }) {
  return (
    <div style={tone === 'warning' ? { padding: 14, borderRadius: 10, background: '#fff8e6', border: '1px solid #f7d58a' } : undefined}>
      <strong style={{ display: 'block', marginBottom: 6, color: tone === 'warning' ? '#9a6700' : '#1f2937' }}>{label}</strong>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.72, color: '#475569', fontSize: '0.9rem' }}>{text}</div>
    </div>
  );
}
