import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { queryClient } from "./queryClient";

// In-memory token storage (works in sandboxed iframes where cookies are blocked)
let authToken: string | null = null;

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { id: number; username: string } | null;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getApiBase(): string {
  const marker = "__PORT_5000__";
  return marker.startsWith("__") ? "" : marker;
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  return fetch(getApiBase() + url, {
    ...options,
    headers,
    credentials: "include",
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
  });

  const checkAuth = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/check");
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          setState({ isAuthenticated: true, isLoading: false, user: data.user });
        } else {
          authToken = null;
          setState({ isAuthenticated: false, isLoading: false, user: null });
        }
      } else {
        authToken = null;
        setState({ isAuthenticated: false, isLoading: false, user: null });
      }
    } catch {
      authToken = null;
      setState({ isAuthenticated: false, isLoading: false, user: null });
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Ошибка входа");
    }
    const data = await res.json();
    authToken = data.token;
    queryClient.clear();
    setState({ isAuthenticated: true, isLoading: false, user: data.user });
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await authFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Ошибка регистрации");
    }
    const data = await res.json();
    authToken = data.token;
    queryClient.clear();
    setState({ isAuthenticated: true, isLoading: false, user: data.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    authToken = null;
    queryClient.clear();
    setState({ isAuthenticated: false, isLoading: false, user: null });
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Listen for 401 events from queryClient
  useEffect(() => {
    const handler = () => {
      authToken = null;
      queryClient.clear();
      setState({ isAuthenticated: false, isLoading: false, user: null });
    };
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
