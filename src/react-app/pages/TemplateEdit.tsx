import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import { FontSize, FONT_SIZES, FONT_SIZE_LABELS } from '../extensions/FontSize';
import { api } from '../api';
import { useAuthStore } from '../store';
import FileImport from '../components/FileImport';
import Select from '../components/Select';

const CATEGORY_OPTS = [
  { value: '근태/휴가', label: '근태/휴가' },
  { value: '인사/채용', label: '인사/채용' },
  { value: '경비/비용', label: '경비/비용' },
  { value: '업무/보고', label: '업무/보고' },
];

export default function TemplateEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isNew = id === 'new';
  const canEdit = !!user && ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role);

  // 권한 없으면 목록으로
  if (!canEdit) { navigate('/templates'); return null; }
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '템플릿 내용을 입력하세요. 이 내용이 문서 작성 시 기본 구조로 사용됩니다.' }),
      Highlight,
      TextStyle,
      Color,
      FontSize,
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content: '',
  });

  useEffect(() => {
    if (!isNew && id) {
      api.templates.get(id).then(({ template }) => {
        setTitle(template.title);
        setDescription(template.description);
        setCategory(template.category || '');
        if (editor) {
          editor.commands.setContent(template.content === '{}' ? '' : template.content);
        }
      }).catch(() => navigate('/templates'));
    }
  }, [id, editor]);

  const handleSave = async () => {
    if (!title) {
      alert('제목을 입력하세요.');
      return;
    }

    setSaving(true);
    const content = editor?.getHTML() || '';

    try {
      if (isNew) {
        await api.templates.create({ title, description, content, category });
      } else if (id) {
        await api.templates.update(id, { title, description, content, category });
      }
      navigate('/templates');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFileImport = (html: string, fileName: string) => {
    if (editor) {
      editor.commands.setContent(html);
    }
    // Auto-fill title from filename if empty
    if (!title) {
      const name = fileName.replace(/\.(docx?|hwpx?|html?|txt)$/i, '');
      setTitle(name);
    }
  };

  return (
    <div className="page editor-page">
      <div className="editor-header">
        <div className="editor-header-left">
          <button className="btn btn-sm" onClick={() => navigate('/templates')}>← 목록</button>
          <h2 style={{ margin: 0 }}>{isNew ? '새 템플릿' : '템플릿 편집'}</h2>
        </div>
        <div className="editor-header-right">
          <FileImport onImport={handleFileImport} />
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장중...' : '저장'}
          </button>
        </div>
      </div>

      <div className="template-form">
        <div className="form-group">
          <label>템플릿 제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 회의록, 보고서, 제안서"
          />
        </div>
        <div className="form-group">
          <label>카테고리</label>
          <Select
            options={CATEGORY_OPTS}
            value={CATEGORY_OPTS.find(o => o.value === category) || null}
            onChange={(o: any) => setCategory(o?.value || '')}
            placeholder="카테고리 선택"
            isClearable
          />
        </div>
        <div className="form-group">
          <label>설명</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="템플릿에 대한 간단한 설명"
          />
        </div>
      </div>

      <div className="editor-body">
        <div className="toolbar">
          {editor && (
            <>
              {/* Font Size Controls */}
              <button
                className="toolbar-btn"
                onClick={() => {
                  const current = editor.getAttributes('textStyle').fontSize || '16px';
                  const idx = FONT_SIZES.indexOf(current);
                  if (idx > 0) editor.chain().focus().setFontSize(FONT_SIZES[idx - 1]).run();
                }}
                title="글자 크기 줄이기"
              >
                A−
              </button>
              <select
                className="toolbar-select"
                value={editor.getAttributes('textStyle').fontSize || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    editor.chain().focus().setFontSize(e.target.value).run();
                  } else {
                    editor.chain().focus().unsetFontSize().run();
                  }
                }}
                title="글자 크기"
              >
                <option value="">크기</option>
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>{FONT_SIZE_LABELS[size]}pt</option>
                ))}
              </select>
              <button
                className="toolbar-btn"
                onClick={() => {
                  const current = editor.getAttributes('textStyle').fontSize || '16px';
                  const idx = FONT_SIZES.indexOf(current);
                  if (idx < FONT_SIZES.length - 1) editor.chain().focus().setFontSize(FONT_SIZES[idx + 1]).run();
                  else if (idx === -1) editor.chain().focus().setFontSize('18px').run();
                }}
                title="글자 크기 키우기"
              >
                A+
              </button>
              <span className="toolbar-divider" />
              <button
                className={`toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <strong>B</strong>
              </button>
              <button
                className={`toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <em>I</em>
              </button>
              <button
                className={`toolbar-btn ${editor.isActive('underline') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <u>U</u>
              </button>
              <button
                className={`toolbar-btn ${editor.isActive('strike') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <s>S</s>
              </button>
              <span className="toolbar-divider" />
              <button
                className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              >
                H1
              </button>
              <button
                className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              >
                H2
              </button>
              <button
                className={`toolbar-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              >
                H3
              </button>
              <span className="toolbar-divider" />
              <button
                className={`toolbar-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                • 목록
              </button>
              <button
                className={`toolbar-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                1. 목록
              </button>
              <span className="toolbar-divider" />
              <button
                className={`toolbar-btn ${editor.isActive({ textAlign: 'left' }) ? 'active' : ''}`}
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
              >
                좌
              </button>
              <button
                className={`toolbar-btn ${editor.isActive({ textAlign: 'center' }) ? 'active' : ''}`}
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
              >
                중
              </button>
              <button
                className={`toolbar-btn ${editor.isActive({ textAlign: 'right' }) ? 'active' : ''}`}
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
              >
                우
              </button>
              <span className="toolbar-divider" />
              <button
                className={`toolbar-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              >
                인용
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              >
                ─
              </button>
              <span className="toolbar-divider" />
              <button className="toolbar-btn" onClick={() => editor.chain().focus().undo().run()}>↩</button>
              <button className="toolbar-btn" onClick={() => editor.chain().focus().redo().run()}>↪</button>
            </>
          )}
        </div>
        <div className="editor-content-wrapper">
          <EditorContent editor={editor} className="editor-area" />
        </div>
      </div>
    </div>
  );
}
