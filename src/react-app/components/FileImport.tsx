import { useRef, useState } from 'react';

interface Props {
  onImport: (html: string, fileName: string) => void;
}

export default function FileImport({ onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');

    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      if (ext === 'docx' || ext === 'doc') {
        await handleDocx(file);
      } else if (ext === 'hwp') {
        await handleHwp(file);
      } else if (ext === 'hwpx') {
        await handleHwpx(file);
      } else if (ext === 'html' || ext === 'htm') {
        await handleHtml(file);
      } else if (ext === 'txt') {
        await handleTxt(file);
      } else {
        setError('지원하지 않는 파일 형식입니다. (지원: .docx, .hwp, .hwpx, .html, .txt)');
      }
    } catch (err: any) {
      console.error(err);
      setError(`파일 변환 실패: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDocx = async (file: File) => {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
        ],
      }
    );

    if (result.messages.length > 0) {
      console.log('mammoth warnings:', result.messages);
    }

    const html = postProcessHtml(result.value);
    onImport(html, file.name);
  };

  const handleHwp = async (file: File) => {
    try {
      const HWP = await import('hwp.js');
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      // hwp.js returns a parsed document object
      const hwpDoc = HWP.default ? HWP.default.parse(uint8 as any) : (HWP as any).parse(uint8 as any);

      // Extract text content from the HWP document
      let html = '';

      if (hwpDoc && hwpDoc.sections) {
        for (const section of hwpDoc.sections) {
          if (section.content) {
            for (const paragraph of section.content) {
              const text = extractHwpText(paragraph);
              if (text.trim()) {
                html += `<p>${escapeHtml(text)}</p>`;
              }
            }
          }
        }
      }

      if (!html) {
        // Fallback: try reading as text
        const text = await file.text();
        const lines = text.split('\n').filter((l) => l.trim());
        html = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
      }

      if (!html) {
        throw new Error('HWP 파일에서 내용을 추출할 수 없습니다.');
      }

      onImport(html, file.name);
    } catch (err: any) {
      // Fallback: basic text extraction
      console.warn('hwp.js parse failed, trying text extraction:', err);
      const text = await extractTextFallback(file);
      if (text) {
        const html = text.split('\n').filter((l) => l.trim()).map((l) => `<p>${escapeHtml(l)}</p>`).join('');
        onImport(html, file.name);
      } else {
        throw new Error('HWP 파일 파싱에 실패했습니다. HWPX 또는 DOCX 형식으로 변환 후 다시 시도해주세요.');
      }
    }
  };

  const handleHwpx = async (file: File) => {
    // HWPX is an XML-based format (ZIP archive with XML inside)
    // We can extract text from the XML content
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());

      let html = '';
      // HWPX stores content in Contents/section*.xml
      const sectionFiles = Object.keys(zip.files).filter(
        (name) => name.startsWith('Contents/section') && name.endsWith('.xml')
      );

      for (const sectionFile of sectionFiles.sort()) {
        const content = await zip.files[sectionFile].async('text');
        // Parse XML and extract text
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, 'text/xml');
        const paragraphs = xmlDoc.getElementsByTagName('hp:p');

        for (let i = 0; i < paragraphs.length; i++) {
          const runs = paragraphs[i].getElementsByTagName('hp:t');
          let pText = '';
          for (let j = 0; j < runs.length; j++) {
            pText += runs[j].textContent || '';
          }
          if (pText.trim()) {
            html += `<p>${escapeHtml(pText)}</p>`;
          }
        }
      }

      if (!html) {
        throw new Error('HWPX 파일에서 내용을 추출할 수 없습니다.');
      }

      onImport(html, file.name);
    } catch {
      throw new Error('HWPX 파일 파싱에 실패했습니다.');
    }
  };

  const handleHtml = async (file: File) => {
    const text = await file.text();
    // Extract body content if full HTML
    const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const html = bodyMatch ? bodyMatch[1] : text;
    onImport(html, file.name);
  };

  const handleTxt = async (file: File) => {
    const text = await file.text();
    const html = text.split('\n').map((line) =>
      line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'
    ).join('');
    onImport(html, file.name);
  };

  return (
    <div className="file-import">
      <input
        ref={fileRef}
        type="file"
        accept=".docx,.doc,.hwp,.hwpx,.html,.htm,.txt"
        onChange={handleFile}
        style={{ display: 'none' }}
        id="file-import-input"
      />
      <button
        className="btn btn-sm"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        title="한글(.hwp), 워드(.docx), HTML, TXT 파일을 가져와 템플릿으로 사용"
      >
        {loading ? '변환중...' : '📎 파일 가져오기'}
      </button>
      {error && <span className="file-import-error">{error}</span>}

      <span className="file-import-hint">
        .docx, .hwp, .hwpx, .html, .txt
      </span>
    </div>
  );
}

// Helpers
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractHwpText(paragraph: any): string {
  if (!paragraph) return '';
  if (typeof paragraph === 'string') return paragraph;
  if (paragraph.text) return paragraph.text;
  if (paragraph.content) {
    if (Array.isArray(paragraph.content)) {
      return paragraph.content.map(extractHwpText).join('');
    }
    return extractHwpText(paragraph.content);
  }
  if (paragraph.children) {
    if (Array.isArray(paragraph.children)) {
      return paragraph.children.map(extractHwpText).join('');
    }
  }
  return '';
}

function postProcessHtml(html: string): string {
  // Clean up mammoth output
  return html
    .replace(/<p>\s*<\/p>/g, '<p><br></p>')  // Empty paragraphs
    .replace(/\n{3,}/g, '\n\n');              // Excessive newlines
}

async function extractTextFallback(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Try to extract readable Korean/English text from binary
    const decoder = new TextDecoder('euc-kr', { fatal: false });
    const text = decoder.decode(bytes);
    // Filter to only printable content
    const lines = text.split('\n')
      .map((l) => l.replace(/[^\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FFa-zA-Z0-9\s.,!?;:'"()\-+=%#@&*\/\\[\]{}|~`^<>]/g, ''))
      .filter((l) => l.trim().length > 2);
    return lines.join('\n');
  } catch {
    return '';
  }
}
