# Contact Avatar Resolver

IMDS resolves patient avatars through tenant-scoped `crm_contacts`. Avatar sources are ranked so a future WhatsApp session provider can override CRM/MIS/import photos without changing Inbox rendering. The current production implementation stores image bytes in the private `contact-avatars` Supabase Storage bucket and exposes them only through the authenticated Worker.
