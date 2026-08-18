export type OnboardingItem = { id: string; label: string; done: boolean; hint: string };
export type ClinicOperatingSnapshot = {
  id: string;
  name: string;
  slug: string;
  role: string;
  accessSource: 'membership' | 'platform';
  current: boolean;
  onboarding: { progress: number; completed: number; total: number; items: OnboardingItem[] };
  usage: { users: number; leads: number; openTasks: number; integrations: number };
  performance: { leads: number; sales: number; revenueKzt: number };
  health: { whatsapp: boolean; telephony: boolean; meta: boolean; google: boolean; mis: boolean };
};
export type OperatingOverview = {
  currentCompanyId: string;
  current: ClinicOperatingSnapshot | null;
  clinics: ClinicOperatingSnapshot[];
  network: { clinics: number; users: number; leads: number; sales: number; revenueKzt: number; openTasks: number };
  truncated: boolean;
  totalAccessibleClinics: number;
  generatedAt: string;
};

export async function loadOperatingOverview(): Promise<OperatingOverview> {
  const response = await fetch('/api/operating-overview', { cache: 'no-store' });
  const raw = await response.text();
  let payload: Partial<OperatingOverview> & { error?: string } = {};
  try { payload = raw ? JSON.parse(raw) as typeof payload : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || raw || `Operating overview HTTP ${response.status}`);
  return payload as OperatingOverview;
}
