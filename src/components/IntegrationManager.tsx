import { useEffect } from 'react';
import IntegrationWorkspace from './IntegrationWorkspace';
import { marketingApi, type IntegrationProvider } from '../services/api';
import '../integration-catalog.css';

type WabaConfig = {
  configured: boolean;
  appId: string;
  configId: string;
  version: string;
  connected: boolean;
  connection?: { values?: { wabaId?: string; phoneNumberId?: string }; lastVerifiedAt?: string | null } | null;
  error?: string;
};
