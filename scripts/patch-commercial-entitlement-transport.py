from pathlib import Path

p = Path('server/platformControl.ts')
s = p.read_text()

old = "export type PlatformLimitKey = 'clinics' | 'users' | 'leads' | 'openTasks' | 'integrations';\nexport type PlatformLimits = Partial<Record<PlatformLimitKey, number>>;"
new = "export type PlatformLimitKey = 'clinics' | 'users' | 'leads' | 'openTasks' | 'integrations';\nexport type PlatformCommercialLimitKey = PlatformLimitKey | 'branches' | 'whatsapp_channels' | 'waba_accounts' | 'whatsapp_numbers' | 'telephony_channels' | 'call_minutes' | 'transcription_minutes' | 'call_recording_days' | 'ai_requests' | 'automation_runs' | 'storage_gb' | 'meta_ad_accounts' | 'meta_pages' | 'meta_datasets';\nexport type PlatformLimits = Partial<Record<PlatformCommercialLimitKey, number>>;"
if old not in s and new not in s:
    raise SystemExit('limit type anchor missing')
s = s.replace(old, new, 1)

old = "const limitKeys: PlatformLimitKey[] = ['clinics', 'users', 'leads', 'openTasks', 'integrations'];"
new = "const limitKeys: PlatformCommercialLimitKey[] = ['clinics', 'users', 'leads', 'openTasks', 'integrations', 'branches', 'whatsapp_channels', 'waba_accounts', 'whatsapp_numbers', 'telephony_channels', 'call_minutes', 'transcription_minutes', 'call_recording_days', 'ai_requests', 'automation_runs', 'storage_gb', 'meta_ad_accounts', 'meta_pages', 'meta_datasets'];"
if old not in s and new not in s:
    raise SystemExit('limitKeys anchor missing')
s = s.replace(old, new, 1)

old = "const entitlementLimitKeys: Array<[string, PlatformLimitKey]> = [\n  ['limits.clinics', 'clinics'], ['marketing.limits.clinics', 'clinics'],\n  ['limits.users', 'users'], ['marketing.limits.users', 'users'],\n  ['limits.leads', 'leads'], ['marketing.limits.leads', 'leads'],\n  ['limits.open_tasks', 'openTasks'], ['marketing.limits.open_tasks', 'openTasks'],\n  ['limits.integrations', 'integrations'], ['marketing.limits.integrations', 'integrations'],\n];"
new = "const entitlementLimitKeys: Array<[string, PlatformCommercialLimitKey]> = [\n  ['limits.clinics', 'clinics'], ['marketing.limits.clinics', 'clinics'],\n  ['limits.users', 'users'], ['marketing.limits.users', 'users'],\n  ['limits.leads', 'leads'], ['marketing.limits.leads', 'leads'],\n  ['limits.open_tasks', 'openTasks'], ['marketing.limits.open_tasks', 'openTasks'],\n  ['limits.integrations', 'integrations'], ['marketing.limits.integrations', 'integrations'],\n  ['limits.branches', 'branches'], ['marketing.limits.branches', 'branches'],\n  ['limits.whatsapp_channels', 'whatsapp_channels'], ['marketing.limits.whatsapp_channels', 'whatsapp_channels'],\n  ['limits.waba_accounts', 'waba_accounts'], ['marketing.limits.waba_accounts', 'waba_accounts'],\n  ['limits.whatsapp_numbers', 'whatsapp_numbers'], ['marketing.limits.whatsapp_numbers', 'whatsapp_numbers'],\n  ['limits.telephony_channels', 'telephony_channels'], ['marketing.limits.telephony_channels', 'telephony_channels'],\n  ['limits.call_minutes', 'call_minutes'], ['marketing.limits.call_minutes', 'call_minutes'],\n  ['limits.transcription_minutes', 'transcription_minutes'], ['marketing.limits.transcription_minutes', 'transcription_minutes'],\n  ['limits.call_recording_days', 'call_recording_days'], ['marketing.limits.call_recording_days', 'call_recording_days'],\n  ['limits.ai_requests', 'ai_requests'], ['marketing.limits.ai_requests', 'ai_requests'],\n  ['limits.automation_runs', 'automation_runs'], ['marketing.limits.automation_runs', 'automation_runs'],\n  ['limits.storage_gb', 'storage_gb'], ['marketing.limits.storage_gb', 'storage_gb'],\n  ['limits.meta_ad_accounts', 'meta_ad_accounts'], ['marketing.limits.meta_ad_accounts', 'meta_ad_accounts'],\n  ['limits.meta_pages', 'meta_pages'], ['marketing.limits.meta_pages', 'meta_pages'],\n  ['limits.meta_datasets', 'meta_datasets'], ['marketing.limits.meta_datasets', 'meta_datasets'],\n];"
if old not in s and new not in s:
    raise SystemExit('entitlement mapping anchor missing')
s = s.replace(old, new, 1)

old = "{ test: (p) => p.startsWith('/api/transcription') || p.startsWith('/api/voice-transcription'), module: 'marketing.voice-transcription' },"
new = "{ test: (p) => p.startsWith('/api/transcription') || p.startsWith('/api/voice-transcription'), module: 'marketing.call-center' },"
if old not in s and new not in s:
    raise SystemExit('transcription route anchor missing')
s = s.replace(old, new, 1)

p.write_text(s)
