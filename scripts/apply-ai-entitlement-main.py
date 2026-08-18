from pathlib import Path

p = Path('src/MarketingPlatform.tsx')
s = p.read_text()
replacements = [
    ("{ to: '/assistant', label: 'IMDS Intelligence', icon: Bot, moduleId: 'analytics.reports', platformModule: 'marketing.analytics' },", "{ to: '/assistant', label: 'IMDS Intelligence', icon: Bot, moduleId: 'analytics.reports', platformModule: 'marketing.ai' },"),
    ("<Route path=\"/assistant\" element={guard('analytics.reports', <MarketingAiPage/>, 'marketing.analytics')} />", "<Route path=\"/assistant\" element={guard('analytics.reports', <MarketingAiPage/>, 'marketing.ai')} />"),
    ("<h2>BELES отключён</h2><p>Доступ к продукту приостановлен в IMDS Super Admin для этой организации.</p>", "<h2>IMDS Marketing отключён</h2><p>Доступ к продукту приостановлен в IMDS Control Center для этой организации.</p>"),
    ("'Модуль отключён для этой организации в IMDS Super Admin.'", "'Модуль отключён для этой организации в IMDS Control Center.'"),
]
for old, new in replacements:
    if old not in s:
        if new in s:
            continue
        raise SystemExit(f'missing expected anchor: {old[:80]}')
    s = s.replace(old, new, 1)
p.write_text(s)
