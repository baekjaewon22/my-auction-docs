import { create } from 'zustand';
import type { User } from './types';
import { api } from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, login_type?: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: true,

  login: async (email, password, login_type?: string) => {
    const { token, user } = await api.auth.login(email, password, login_type);
    localStorage.setItem('token', token);
    set({ token, user, loading: false });
    // 서명 동기화: DB → localStorage
    try {
      const { syncSignatureFromServer } = await import('./components/SignaturePanel');
      await syncSignatureFromServer();
    } catch { /* */ }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null, loading: false });
  },

  loadUser: async () => {
    const token = localStorage.getItem('token');
    if (!token) { set({ loading: false }); return; }
    try {
      const { user } = await api.auth.me();
      set({ user, token, loading: false });
      // 서명 동기화
      const u = user as any;
      if (u.saved_signature) {
        localStorage.setItem('myauction_saved_signature', u.saved_signature);
      }
    } catch (err: any) {
      console.error('[loadUser] failed:', err?.message);
      // 401(인증 만료)인 경우에만 토큰 제거, 그 외 에러는 토큰 유지하고 재시도
      if (err?.message === 'Unauthorized') {
        localStorage.removeItem('token');
        set({ user: null, token: null, loading: false });
      } else {
        // 네트워크 오류 등 → 토큰은 유지, 3초 후 재시도
        setTimeout(async () => {
          try {
            const { user } = await api.auth.me();
            set({ user, token, loading: false });
          } catch {
            localStorage.removeItem('token');
            set({ user: null, token: null, loading: false });
          }
        }, 2000);
      }
    }
  },
}));
