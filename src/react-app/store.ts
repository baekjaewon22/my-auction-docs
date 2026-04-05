import { create } from 'zustand';
import type { User } from './types';
import { api } from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: sessionStorage.getItem('token'),
  loading: true,

  login: async (email, password) => {
    const { token, user } = await api.auth.login(email, password);
    sessionStorage.setItem('token', token);
    set({ token, user, loading: false });
    // 서명 동기화: DB → localStorage
    try {
      const { syncSignatureFromServer } = await import('./components/SignaturePanel');
      await syncSignatureFromServer();
    } catch { /* */ }
  },

  logout: () => {
    sessionStorage.removeItem('token');
    set({ user: null, token: null, loading: false });
  },

  loadUser: async () => {
    const token = sessionStorage.getItem('token');
    if (!token) { set({ loading: false }); return; }
    try {
      const { user } = await api.auth.me();
      set({ user, token, loading: false });
      // 서명 동기화
      const u = user as any;
      if (u.saved_signature) {
        localStorage.setItem('myauction_saved_signature', u.saved_signature);
      }
    } catch {
      sessionStorage.removeItem('token');
      set({ user: null, token: null, loading: false });
    }
  },
}));
