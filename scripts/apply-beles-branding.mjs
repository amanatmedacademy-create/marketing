import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const replacements = [
  ['IMDS MARKETING HUB', 'BELES HUB'],
  ['IMDS MARKETING', 'BELES'],
  ['IMDS Marketing', 'BELES'],
  ['Вход в IMDS', 'Вход в BELES'],
];

const textExtensions = new Set(['.ts', '.tsx']);

function replaceBranding(path) {
  const original = readFileSync(path, 'utf8');
  let next = original;
  for (const [from, to] of replacements) next = next.split(from).join(to);
  if (next !== original) writeFileSync(path, next);
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path);
    else if (textExtensions.has(extname(path))) replaceBranding(path);
  }
}

walk('src');
replaceBranding('index.html');

const brandComponent = `type ImdsBrandProps = {
  compact?: boolean;
  className?: string;
};

export default function ImdsBrand({ compact = false, className = '' }: ImdsBrandProps) {
  const logoWidth = compact ? 158 : 198;
  return <div
    className={className}
    style={{ display: 'flex', alignItems: 'center', minWidth: 0, lineHeight: 0 }}
  >
    <svg
      width={logoWidth}
      height={compact ? 50 : 64}
      viewBox="0 0 455 120"
      role="img"
      aria-label="BELES by IMDS TECH"
      style={{ display: 'block', maxWidth: '100%', height: 'auto', flex: '0 0 auto' }}
    >
      <defs>
        <linearGradient id="belesBrandTeal" x1="14" y1="14" x2="98" y2="108" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#18c2b2"/>
          <stop offset="0.58" stopColor="#22cdbc"/>
          <stop offset="1" stopColor="#0a8f98"/>
        </linearGradient>
        <linearGradient id="belesBrandNavy" x1="29" y1="19" x2="91" y2="103" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#12384a"/>
          <stop offset="1" stopColor="#071827"/>
        </linearGradient>
      </defs>

      <g transform="translate(3 2)">
        <path d="M54 7 99 33v52l-45 26L9 85V33L54 7Z" fill="url(#belesBrandNavy)" stroke="#5fe6d6" strokeWidth="1.6" strokeLinejoin="round"/>
        <path d="M17 59V38L54 17l36 21-13 8-23-13-24 14v20L17 59Z" fill="url(#belesBrandTeal)"/>
        <path d="m69 26 13 8-13 8-13-8 13-8Z" fill="#f5f7fa"/>
        <path d="m18 76 36 21 28-17 11 8-39 23-36-21V76Z" fill="url(#belesBrandTeal)" opacity="0.82"/>
        <g fill="url(#belesBrandTeal)">
          <path d="M26 72h10v17l-10-6V72Z"/>
          <path d="M42 61h10v37l-10-6V61Z"/>
          <path d="M58 49h10v42l-10 6V49Z"/>
        </g>
        <path d="M68 45 91 59 68 73V45Z" fill="#f7f8fa" stroke="#ffffff" strokeWidth="1.2" strokeLinejoin="round"/>
      </g>

      <text x="126" y="55" fill="var(--imds-logo-main, #102b3a)" fontFamily="Inter, Arial, sans-serif" fontSize="39" fontWeight="800" letterSpacing="1.8">BELES</text>
      <text x="127" y="83" fill="var(--imds-muted, #78909a)" fontFamily="Inter, Arial, sans-serif" fontSize="16" fontWeight="600">by</text>
      <text x="151" y="83" fill="var(--imds-logo-main, #102b3a)" fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="800" letterSpacing="0.7">IMDS</text>
      <text x="205" y="83" fill="#18c2b2" fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="800" letterSpacing="0.7">TECH</text>
    </svg>
  </div>;
}
`;

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-labelledby="title desc">
  <title id="title">BELES</title>
  <desc id="desc">BELES by IMDS TECH application icon</desc>
  <defs>
    <linearGradient id="teal" x1="20" y1="15" x2="104" y2="113" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#18c2b2"/>
      <stop offset="0.58" stop-color="#22cdbc"/>
      <stop offset="1" stop-color="#0a8f98"/>
    </linearGradient>
    <linearGradient id="navy" x1="32" y1="22" x2="95" y2="104" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#12384a"/>
      <stop offset="1" stop-color="#071827"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#0b1b29"/>
  <path d="M64 17 106 41v47l-42 24-42-24V41l42-24Z" fill="url(#navy)" stroke="#5fe6d6" stroke-width="1.7" stroke-linejoin="round"/>
  <path d="M29 66V46l35-20 34 20-12 8-22-13-23 13v19L29 66Z" fill="url(#teal)"/>
  <path d="m78 34 12 7-12 8-12-8 12-7Z" fill="#f5f7fa"/>
  <path d="m30 82 34 20 27-16 10 7-37 22-34-20V82Z" fill="url(#teal)" opacity="0.82"/>
  <g fill="url(#teal)">
    <path d="M38 78h9v16l-9-5V78Z"/>
    <path d="M52 68h9v33l-9-5V68Z"/>
    <path d="M66 57h9v38l-9 6V57Z"/>
  </g>
  <path d="m75 54 22 13-22 13V54Z" fill="#f7f8fa" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
`;

writeFileSync('src/components/ImdsBrand.tsx', brandComponent);
writeFileSync('public/imds-logo.svg', appIcon);

console.log('BELES branding applied.');
