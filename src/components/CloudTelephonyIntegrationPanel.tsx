import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, LoaderCircle, RefreshCw, Save, Trash2 } from 'lucide-react';
import { authFetch } from '../services/auth';

type Provider = 'binotel' | 'sipuni';
type ProviderSummary = {
  provider?: string;
  configured?: boolean;
  status?: string;
  values?: Record<string, string>;
  secretFields?: Record<string, boolean>;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};
type ConfigResponse = { provider