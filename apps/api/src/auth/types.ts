export type CompanyRole = 'owner' | 'admin' | 'manager' | 'operator' | 'analyst' | 'accountant';

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type CompanyMembership = {
  companyId: string;
  companyName: string;
  role: CompanyRole;
};

export type AuthContext = {
  user: AuthenticatedUser;
  memberships: CompanyMembership[];
  activeMembership: CompanyMembership;
};
