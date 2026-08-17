import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Crown, LoaderCircle, MailPlus, Pencil, RefreshCw, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import {
  approveOnboardingRequest,
  createTeamInvitation,
  fetchManagedUsers,
  fetchOnboardingRequests,
  fetchTeamInvitations,
  rejectOnboardingRequest,
  removeManagedUser,
  resendTeamInvitation,
  revokeTeamInvitation,
  transferCompanyOwnership,
  updateManagedUser,
  type AssignableUserRole,
  type ManagedUser,
  type ManagedUserStatus,
  type OnboardingRequest,
  type TeamInvitation,
} from '../services/userAdmin';
import { useAuth } from './AuthGate';
import './team-administration.css';

const roleLabels: Record<string, string> = {
  owner: 'Владелец', administrator: 'Администратор', manager: 'Менеджер', marketer: 'Маркетолог', operator: 'Оператор', analyst: 'Аналитик', viewer: 'Наблюдатель',
};
const statusLabels: Record<string, string> = { active: 'Активен', invited: 'Ожидает', blocked: 'Заблокирован', pending: 'Отправлено', accepted: 'Принято', revoked: 'Отозвано', expired: 'Истекло' };
const assignableRoles: AssignableUserRole[] = ['administrator', 'manager', 'marketer', 'operator', 'analyst', 'viewer'];

type InviteDraft = { email: string; phone: string; role: AssignableUserRole };
type EditDraft = { id: string; role: AssignableUserRole; status: ManagedUserStatus };

export default function TeamAdministrationPanel() {
  const { user } = useAuth();
  const currentCompany = user.companies?.find((company) => company.id === user.companyId) || user.companies?.[0];
  const actorOwner = currentCompany?.role === 'owner';
  const platformAdmin = user.platformRole === 'super_admin';
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invite, setInvite] = useState<InviteDraft | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [issuedCode, setIssuedCode] = useState<{ email: string; code: string } | null>(null);

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const [nextUsers, nextInvitations, nextOnboarding] = await Promise.all([fetchManagedUsers(), fetchTeamInvitations(), fetchOnboardingRequests()]);
      setUsers(nextUsers); setInvitations(nextInvitations); setOnboarding(nextOnboarding);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить команду'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [user.companyId]);

  const pending = useMemo(() => onboarding.filter((item) => item.status === 'pending_approval' || item.status === 'needs_profile'), [onboarding]);
  const activeInvites = useMemo(() => invitations.filter((item) => item.status === 'pending'), [invitations]);

  const submitInvite = async () => {
    if (!invite) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await createTeamInvitation({ email: invite.email, phone: invite.phone || undefined, role: invite.role });
      setIssuedCode({ email: result.invitation.email, code: result.code });
      setInvite(null); setNotice('Приглашение создано. Код действует 7 дней.');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать приглашение'); }
    finally { setBusy(false); }
  };

  const approve = async (item: OnboardingRequest) => {
    setBusy(true); setError('');
    try { await approveOnboardingRequest(item.id, item.requestedRole); setNotice(`${item.name || item.email} добавлен в клинику.`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось одобрить заявку'); }
    finally { setBusy(false); }
  };
  const reject = async (item: OnboardingRequest) => {
    const reason = window.prompt('Причина отказа', 'Заявка отклонена администратором') || '';
    if (!reason) return;
    setBusy(true); setError('');
    try { await rejectOnboardingRequest(item.id, reason); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отклонить заявку'); }
    finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true); setError('');
    try { await updateManagedUser(edit.id, { role: edit.role, status: edit.status }); setEdit(null); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить доступ'); }
    finally { setBusy(false); }
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice('Код скопирован.'); }
    catch { setError('Не удалось скопировать код'); }
  };

  return <section className="team-admin">
    <div className="team-admin__head"><div><h3>Команда и доступы</h3><p>Приглашения, заявки и роли относятся только к текущей клинике.</p></div><button type="button" onClick={() => setInvite({ email: '', phone: '', role: 'viewer' })}><UserPlus size={15}/>Пригласить</button></div>
    {error && <div className="workspace-message workspace-message--error">{error}</div>}
    {notice && <div className="workspace-message workspace-message--notice">{notice}</div>}
    {loading && <div className="users-loading"><LoaderCircle className="spin"/>Загрузка…</div>}

    {!loading && pending.length > 0 && <div className="team-admin__section"><div className="team-admin__section-title"><UserCheck size={17}/><div><strong>Заявки на вступление</strong><span>{pending.length} ожидают действия</span></div></div><div className="team-admin__cards">{pending.map((item) => <article key={item.id} className="team-admin__request"><div className="team-admin__avatar">{(item.name || item.email)[0]?.toUpperCase()}</div><div className="team-admin__main"><strong>{item.name || item.email}</strong><span>{item.email}</span><small>{item.phone || 'Телефон не указан'}{item.position ? ` · ${item.position}` : ''}</small></div><label><span>Роль</span><select value={item.requestedRole} onChange={(event) => setOnboarding((rows) => rows.map((row) => row.id === item.id ? { ...row, requestedRole: event.target.value as AssignableUserRole } : row))}>{assignableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><div className="team-admin__row-actions"><button type="button" disabled={busy} className="approve" onClick={() => void approve(item)}><Check size={15}/>Принять</button><button type="button" disabled={busy} onClick={() => void reject(item)}><X size={15}/>Отклонить</button></div></article>)}</div></div>}

    {!loading && <div className="team-admin__section"><div className="team-admin__section-title"><MailPlus size={17}/><div><strong>Приглашения</strong><span>{activeInvites.length ? `${activeInvites.length} активных` : 'Нет активных приглашений'}</span></div></div>{activeInvites.length > 0 && <div className="team-admin__cards">{activeInvites.map((item) => <article key={item.id} className="team-admin__invite"><div><strong>{item.email}</strong><span>{roleLabels[item.role]} · до {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('ru-RU') : '—'}</span></div><em>{statusLabels[item.status]}</em><div className="team-admin__icon-actions"><button type="button" title="Новый код" onClick={() => void resendTeamInvitation(item.id).then(async (result) => { setIssuedCode({ email: result.invitation.email, code: result.code }); await refresh(); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}><RefreshCw size={15}/></button><button type="button" title="Отозвать" onClick={() => void revokeTeamInvitation(item.id).then(refresh).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}><Trash2 size={15}/></button></div></article>)}</div>}</div>}

    {!loading && <div className="team-admin__section"><div className="team-admin__section-title"><ShieldCheck size={17}/><div><strong>Сотрудники</strong><span>{users.filter((item) => item.status === 'active').length} активных</span></div></div><div className="team-admin__cards">{users.map((item) => <article key={item.id} className="team-admin__user"><div className="team-admin__avatar">{item.name[0]?.toUpperCase()}</div><div className="team-admin__main"><strong>{item.name}</strong><span>{item.email}</span><small>{item.jobTitle || (item.connected ? 'IMDS Account подключён' : 'Аккаунт ещё не подключён')}</small></div><b className={item.role === 'owner' ? 'owner' : ''}>{item.role === 'owner' && <Crown size={13}/>} {roleLabels[item.role]}</b><em className={`user-status user-status--${item.status}`}>{statusLabels[item.status]}</em><div className="team-admin__icon-actions">{item.role !== 'owner' && <button type="button" title="Изменить" onClick={() => setEdit({ id: item.id, role: item.role as AssignableUserRole, status: item.status })}><Pencil size={15}/></button>}{item.role !== 'owner' && (actorOwner || platformAdmin) && item.status === 'active' && <button type="button" title="Передать владение" onClick={() => { if (window.confirm(`Передать владение клиникой пользователю ${item.name}?`)) void transferCompanyOwnership(item.id).then(() => { setNotice('Владение передано.'); return refresh(); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }}><Crown size={15}/></button>}{item.role !== 'owner' && <button type="button" title="Удалить доступ" onClick={() => { if (window.confirm(`Удалить доступ ${item.name}?`)) void removeManagedUser(item.id).then(refresh).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }}><UserX size={15}/></button>}</div></article>)}</div></div>}

    {invite && <div className="team-admin__modal-layer"><button className="team-admin__overlay" type="button" onClick={() => setInvite(null)}/><form className="team-admin__modal" onSubmit={(event) => { event.preventDefault(); void submitInvite(); }}><header><div><h3>Пригласить сотрудника</h3><p>Создаётся одноразовый код на 7 дней.</p></div><button type="button" onClick={() => setInvite(null)}><X size={18}/></button></header><label><span>Email</span><input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required/></label><label><span>Телефон</span><input value={invite.phone} onChange={(event) => setInvite({ ...invite, phone: event.target.value })} placeholder="+7 700 000 00 00"/></label><label><span>Роль после одобрения</span><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as AssignableUserRole })}>{assignableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><footer><button type="button" onClick={() => setInvite(null)}>Отмена</button><button className="workspace-primary" type="submit" disabled={busy}>{busy ? 'Создание…' : 'Создать приглашение'}</button></footer></form></div>}

    {edit && <div className="team-admin__modal-layer"><button className="team-admin__overlay" type="button" onClick={() => setEdit(null)}/><form className="team-admin__modal" onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}><header><h3>Роль и статус</h3><button type="button" onClick={() => setEdit(null)}><X size={18}/></button></header><label><span>Роль</span><select value={edit.role} onChange={(event) => setEdit({ ...edit, role: event.target.value as AssignableUserRole })}>{assignableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label><span>Статус</span><select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as ManagedUserStatus })}><option value="active">Активен</option><option value="invited">Ожидает</option><option value="blocked">Заблокирован</option></select></label><footer><button type="button" onClick={() => setEdit(null)}>Отмена</button><button className="workspace-primary" type="submit" disabled={busy}>Сохранить</button></footer></form></div>}

    {issuedCode && <div className="team-admin__modal-layer"><button className="team-admin__overlay" type="button" onClick={() => setIssuedCode(null)}/><div className="team-admin__modal team-admin__code"><header><div><h3>Код приглашения</h3><p>{issuedCode.email}</p></div><button type="button" onClick={() => setIssuedCode(null)}><X size={18}/></button></header><div className="team-admin__code-value"><strong>{issuedCode.code}</strong><button type="button" onClick={() => void copy(issuedCode.code)}><Copy size={16}/>Копировать</button></div><p>Код показывается только сейчас. Если он потеряется, выпустите новый код в списке приглашений.</p></div></div>}
  </section>;
}
