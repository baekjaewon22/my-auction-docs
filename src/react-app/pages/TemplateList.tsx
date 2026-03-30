import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { Template } from '../types';
import {
  CalendarDays, UserRound, Wallet, NotebookPen, FileSpreadsheet,
  Plus, Pencil, Trash2
} from 'lucide-react';

const CATEGORY_ICONS: Record<string, typeof CalendarDays> = {
  '근태/휴가': CalendarDays,
  '인사/채용': UserRound,
  '경비/비용': Wallet,
  '업무/보고': NotebookPen,
};

const CATEGORY_ORDER = ['근태/휴가', '인사/채용', '경비/비용', '업무/보고'];

export default function TemplateList() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'master' || user?.role === 'ceo';

  const load = () => {
    setLoading(true);
    api.templates.list().then((res) => setTemplates(res.templates)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    const cat = t.category || '기타';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const handleNewDoc = async (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    const { document } = await api.documents.create({
      title: template?.title || '새 문서',
      template_id: templateId,
    });
    navigate('/documents/' + document.id);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('템플릿을 삭제하시겠습니까?')) return;
    await api.templates.delete(id);
    load();
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  const filteredCategories = activeCategory
    ? categories.filter((c) => c === activeCategory)
    : categories;

  return (
    <div className="page">
      <div className="page-header">
        <h2>템플릿</h2>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => navigate('/templates/new')}>
            <Plus size={16} /> 새 템플릿
          </button>
        )}
      </div>

      <div className="filter-bar">
        <button
          className={`filter-btn ${activeCategory === null ? 'active' : ''}`}
          onClick={() => setActiveCategory(null)}
        >
          전체 ({templates.length})
        </button>
        {categories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat] || FileSpreadsheet;
          return (
            <button
              key={cat}
              className={`filter-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            >
              <Icon size={14} style={{ marginRight: 4 }} /> {cat} ({grouped[cat].length})
            </button>
          );
        })}
      </div>

      {filteredCategories.map((cat) => {
        const Icon = CATEGORY_ICONS[cat] || FileSpreadsheet;
        return (
          <section key={cat} className="template-category-section">
            <div className="template-category-header">
              <Icon size={20} className="template-category-lucide" />
              <h3 className="template-category-title">{cat}</h3>
              <span className="template-category-count">{grouped[cat].length}개</span>
            </div>
            <div className="template-grid">
              {grouped[cat].map((t) => (
                <div key={t.id} className="template-card" onClick={() => handleNewDoc(t.id)}>
                  <div className="template-card-body">
                    <div className="template-name">{t.title}</div>
                    <div className="template-desc">{t.description}</div>
                  </div>
                  <div className="template-card-footer">
                    <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); handleNewDoc(t.id); }}>
                      작성
                    </button>
                    {isAdmin && (
                      <>
                        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); navigate('/templates/' + t.id); }}>
                          <Pencil size={12} />
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={(e) => handleDelete(t.id, e)}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {templates.length === 0 && (
        <div className="empty-state">
          {isAdmin ? '아직 템플릿이 없습니다. 새 템플릿을 만들어보세요!' : '사용 가능한 템플릿이 없습니다.'}
        </div>
      )}
    </div>
  );
}
