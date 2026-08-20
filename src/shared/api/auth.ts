import { apiRequest } from "./client";

// Mirrors the backend's own sanitizeUser() shape (auth/service.js) —
// password_hash is never returned by the API, so it's never modeled here.
export interface User {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role_id: number | null;
  is_platform_admin: boolean;
  // 2.2.1.2.2 — the role's name and its exact "{module}:{action}" grants,
  // returned by both /auth/login and /auth/me. Optional in the type on
  // purpose: a session issued before this field existed simply has no list,
  // and the permission helper fails closed on that rather than assuming
  // access.
  role_name?: string | null;
  permissions?: string[] | null;
  is_active: boolean;
  is_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function login(input: LoginInput): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", { method: "POST", body: input });
}

export function register(input: RegisterInput): Promise<User> {
  return apiRequest<User>("/auth/register", { method: "POST", body: input });
}

export function getCurrentUser(): Promise<User> {
  return apiRequest<User>("/auth/me");
}

export interface Role {
  role_id: number;
  name: string;
  description: string | null;
}

export function listRoles(): Promise<Role[]> {
  return apiRequest<Role[]>("/auth/roles");
}
