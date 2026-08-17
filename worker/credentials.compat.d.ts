import './credentials';

declare module './credentials' {
  export function isFrontendAdmin(request: Request, legacyEnv?: unknown): boolean;
}
