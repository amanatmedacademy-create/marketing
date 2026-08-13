import { handleZadarmaTelephony as handleLegacyZadarmaTelephony, type ZadarmaTelephonyEnv as LegacyZadarmaTelephonyEnv } from './zadarmaTelephonyLegacy';
import { handleUniversalTelephony, type UniversalTelephonyEnv } from './telephonyGateway';
import { handleTelephonyProviderConfig, hydrateTelephonyProviderEnv } from './telephonyProviderCredentials';

export { zadarmaRequest } from './zadarmaTelephonyLegacy';
export type ZadarmaTelephonyEnv = LegacyZadarmaTelephonyEnv & UniversalTelephonyEnv;

export async function handleZadarmaTelephony(request: Request, env: ZadarmaTelephonyEnv, url: URL): Promise<Response | null> {
  const configResponse = await handleTelephonyProviderConfig(request, env, url);
  if (configResponse) return configResponse;
  const runtime = await hydrateTelephonyProviderEnv(env);
  const universalResponse = await handleUniversalTelephony(request, runtime, url);
  if (universalResponse) return universalResponse;
  return handleLegacyZadarmaTelephony(request, runtime, url);
}
