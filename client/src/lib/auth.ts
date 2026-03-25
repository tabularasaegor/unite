let authToken: string | null = null;

export function getToken(): string | null {
  if (!authToken) {
    authToken = (window as any).__AUTH_TOKEN__ || null;
  }
  return authToken;
}

export function setToken(token: string | null) {
  authToken = token;
  (window as any).__AUTH_TOKEN__ = token;
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
