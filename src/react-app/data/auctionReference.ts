import lawSelectboxMarkdown from './auction-reference/law-selectbox.md?raw';
import propertyChecklistMarkdown from './auction-reference/property-checklist.md?raw';
import briefingRightsMarkdown from './auction-reference/briefing-rights.md?raw';

export type AuctionReferenceType = 'rights' | 'legal' | 'checklist';

export interface AuctionReferenceItem {
  id: string;
  type: AuctionReferenceType;
  title: string;
  content: string;
  source: 'default' | 'custom';
  category?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function stripNumbering(title: string): string {
  return title
    .replace(/^[A-Z]-\d+\.\s*/i, '')
    .replace(/^[A-Z]\.\s*/i, '')
    .replace(/^D-\d+\.\s*/i, '')
    .trim();
}

function cleanChecklistText(value: string): string {
  return value
    .replace(/\s*`?\[[A-Z]{2,4}-\d{2}\]`?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSections(markdown: string, type: AuctionReferenceType, headingLevel: 2 | 3): AuctionReferenceItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: AuctionReferenceItem[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const heading = '#'.repeat(headingLevel);

  const push = () => {
    if (!current) return;
    const content = current.lines.join('\n').trim();
    const title = stripNumbering(current.title);
    if (!title || !content) return;
    items.push({
      id: `${type}:${slugify(title) || items.length}`,
      type,
      title,
      content,
      source: 'default',
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (headingMatch && headingMatch[1] === heading) {
      push();
      current = { title: headingMatch[2], lines: [] };
      continue;
    }
    if (headingMatch && current && headingMatch[1].length <= headingLevel) {
      push();
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  push();
  return items;
}

function parseChecklistSections(markdown: string): AuctionReferenceItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: AuctionReferenceItem[] = [];
  let currentCategory = '';
  let current: { title: string; lines: string[]; category: string } | null = null;

  const push = () => {
    if (!current) return;
    const title = stripNumbering(current.title);
    const content = cleanChecklistText(current.lines.join('\n'));
    if (!title || !content) return;
    items.push({
      id: `checklist:${slugify(`${current.category}-${title}`) || items.length}`,
      type: 'checklist',
      title,
      category: current.category || '기타',
      content,
      source: 'default',
    });
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h2) {
      push();
      current = null;
      currentCategory = stripNumbering(h2[1]);
      if (currentCategory.includes('공통')) {
        current = { title: currentCategory, lines: [], category: '공통' };
      }
      continue;
    }
    if (h3) {
      push();
      current = { title: h3[1], lines: [], category: currentCategory || '기타' };
      continue;
    }
    if (current) current.lines.push(line);
  }
  push();
  return items;
}

export const DEFAULT_RIGHTS_REFERENCE = parseSections(briefingRightsMarkdown, 'rights', 2);
export const DEFAULT_LEGAL_REFERENCE = parseSections(lawSelectboxMarkdown, 'legal', 2);
export const DEFAULT_CHECKLIST_REFERENCE = [
  ...parseChecklistSections(propertyChecklistMarkdown),
];

export const DEFAULT_AUCTION_REFERENCES: Record<AuctionReferenceType, AuctionReferenceItem[]> = {
  rights: DEFAULT_RIGHTS_REFERENCE,
  legal: DEFAULT_LEGAL_REFERENCE,
  checklist: DEFAULT_CHECKLIST_REFERENCE,
};
