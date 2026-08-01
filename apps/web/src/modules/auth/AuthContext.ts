import { createContext, useContext } from 'react';

export type CurrentUser = {
  profileId: string;
  authUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  companyId: string;
  companyName: string;
  role: string;
  status: string;
};

export type AuthContextValue = {
  currentUser: CurrentUser;
  initials: string;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthGate');
  return value;
}
