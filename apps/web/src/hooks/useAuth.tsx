import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@exam/shared';
import { api, clearToken, getToken, onUnauthorized, setToken } from '../lib/api';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  canChangePassword: boolean;
}

type LoginResponse = { token: string; user: AuthUser };
type MeResponse = { user: AuthUser };

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => onUnauthorized(logout), [logout]);

  useEffect(() => {
    if (!getToken()) return;

    async function loadUser() {
      try {
        const { user: currentUser } = await api.get<MeResponse>('/auth/me');
        setUser(currentUser);
      } catch {
        logout();
      } finally {
        setLoading(false);
      }
    }

    void loadUser();
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user: authenticatedUser } = await api.post<LoginResponse>('/auth/login', {
      username,
      password,
    });
    setToken(token);
    setUser(authenticatedUser);
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
