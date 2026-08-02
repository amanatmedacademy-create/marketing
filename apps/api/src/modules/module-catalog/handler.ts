import { platformModules } from '@imds/contracts';
import { json } from '../../shared/http';

export function handleModuleCatalog(): Response {
  return json({ items: platformModules, total: platformModules.length });
}
