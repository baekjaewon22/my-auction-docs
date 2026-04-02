import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { Template } from '../types';
import {
  CalendarDays, UserRound, Wallet, NotebookPen, FileSpreadsheet,
  Plus, Pencil, Trash2, Star
} from 'lucide-react';

const CATEGORY_ICONS: Record<string, typeof CalendarDays> = {
  '근태/휴가': CalendarDays,
  '인사/채용': UserRound,
  '경비/비용': Wallet,
  '업무/보고': NotebookPen,
};

const CATEGORY_ORDER = ['근태/휴가', '인사/채용', '경비/비용', '업무/보고'];
const FAV_KEY = 'myauction_fav_templates';
const FAV_INIT_KEY = 'myauction_fav_initialized';
const DEFAULT_FAVS = ['tpl-att-001', 'tpl-att-002', 'tpl-att-003', 'tpl-work-002', 'tpl-work-007'];

function getFavorites(): string[] {
  try {
    if (!localStorage.getItem(FAV_INIT_KEY)) {
      localStorage.setItem(FAV_KEY, JSON.stringify(DEFAULT_FAVS));
      localStorage.setItem(FAV_INIT_KEY, '1');
      return [...DEFAULT_FAVS];
    }
    return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
  } catch { return []; }
}

function toggleFavorite(id: string): string[] {
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(id);
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  return [...favs];
}

export default function TemplateList() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(getFavorites());
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = !!user && ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role);

  const load = () => {
    setLoading(true);
    api.templates.list().then((res) => setTemplates(res.templates)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleFav = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(toggleFavorite(id));
  };

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

  const favTemplates = templates.filter((t) => favorites.includes(t.id));

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

  const filteredCategories = activeCategory === '즐겨찾기'
    ? []
    : activeCategory
      ? categories.filter((c) => c === activeCategory)
      : categories;

  const renderCard = (t: Template) => {
    const isFav = favorites.includes(t.id);
    return (
      <div key={t.id} className="template-card">
        <button className={`template-fav-btn ${isFav ? 'active' : ''}`} onClick={(e) => handleFav(t.id, e)} title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}>
          <Star size={14} fill={isFav ? '#f9ab00' : 'none'} />
        </button>
        <div className="template-card-body">
          <div className="template-name">{t.title}</div>
          <div className="template-desc">{t.description}</div>
        </div>
        <div className="template-card-footer">
          <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); handleNewDoc(t.id); }}>작성</button>
          {isAdmin && (
            <>
              <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); navigate('/templates/' + t.id); }}><Pencil size={12} /></button>
              <button className="btn btn-sm btn-danger" onClick={(e) => handleDelete(t.id, e)}><Trash2 size={12} /></button>
            </>
          )}
        </div>
      </div>
    );
  };

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
        <button
          className={`filter-btn fav-filter ${activeCategory === '즐겨찾기' ? 'active' : ''}`}
          onClick={() => setActiveCategory(activeCategory === '즐겨찾기' ? null : '즐겨찾기')}
        >
          <Star size={14} fill={activeCategory === '즐겨찾기' ? '#fff' : '#f9ab00'} style={{ marginRight: 4 }} />
          즐겨찾기 ({favTemplates.length})
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

      {/* 즐겨찾기 섹션 - 전체보기 또는 즐겨찾기 탭 선택 시 */}
      {(activeCategory === null || activeCategory === '즐겨찾기') && favTemplates.length > 0 && (
        <section className="template-category-section template-fav-section">
          <div className="template-category-header">
            <Star size={20} className="template-category-lucide" fill="#f9ab00" color="#f9ab00" />
            <h3 className="template-category-title">즐겨찾기</h3>
            <span className="template-category-count">{favTemplates.length}개</span>
          </div>
          <div className="template-grid">
            {favTemplates.map(renderCard)}
          </div>
        </section>
      )}

      {activeCategory === '즐겨찾기' && favTemplates.length === 0 && (
        <div className="empty-state">즐겨찾기한 템플릿이 없습니다. ⭐ 별 버튼으로 추가해보세요.</div>
      )}

      {/* 카테고리 섹션 */}
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
              {grouped[cat].map(renderCard)}
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
