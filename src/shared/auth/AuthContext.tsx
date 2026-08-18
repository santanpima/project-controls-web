import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import * as authApi from "@shared/api/auth";
import { setTokenGetter, setUnauthorizedHandler, ApiError } from "@shared/api/client";

// 1.2.1.2.3 / 4.1.1.1.2 describe a thin AuthContext wrapping Firebase's
// onAuthStateChanged listener. Adapted here to the real backend (see
// client.ts's own note on this): there's no Firebase listener to wrap, so
// this instead (1) checks sessionStorage for a previously-issued token on
// mount, (2) validates it against GET /me rather than trusting it blindly,
// and (3) exposes the same shape — current user, loading state, sign
// in/out — that the rest of the app was always going to consume regardless
// of what sits behind it.
//
// Token storage: sessionStorage, not localStorage — cleared automatically
// when the tab closes, a reasonable middle ground between "log in every
// single page load" and a token that silently persists indefinitely. Not
// an httpOnly cookie (the more defensible option against XSS) because that
// needs the backend to set it, which would mean the backend's login
// response format changing — a larger, separate decision than this
// frontend phase should make unilaterally.
const TOKEN_STORAGE_KEY = "pc_auth_token";

interface AuthContextValue {
  user: authApi.User | null;
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: authApi.RegisterInput) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<authApi.User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Wire the API client to this context's own state, once, at mount — see
  // client.ts for why this is an injected getter rather than a direct import.
  useEffect(() => {
    setTokenGetter(() => token);
  }, [token]);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
  }, [signOut]);

  // On first load: a token in sessionStorage is a claim, not a fact — it
  // could be expired or the account could have since been deactivated.
  // Validated against GET /me before ever being trusted.
  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setToken(stored);
    authApi
      .getCurrentUser()
      .then((currentUser) => setUser(currentUser))
      .catch(() => {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { token: newToken, user: newUser } = await authApi.login({ email, password });
    sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const signUp = useCallback(async (input: authApi.RegisterInput) => {
    await authApi.register(input);
    // Registration doesn't return a session (2.1.1.1.1 defaults every new
    // account to the 'viewer' role, not an auto-signed-in state) — the
    // person signs in separately afterward, the same two-step flow a
    // real Identity Platform registration would also have required.
  }, []);

  const value: AuthContextValue = { user, token, isLoading, signIn, signUp, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { ApiError };
