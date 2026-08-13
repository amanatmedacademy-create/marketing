import { Container } from '@cloudflare/containers';

export class WhatsAppSessionContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '2h';
  enableInternet = true;
  pingEndpoint = '/health';
}
