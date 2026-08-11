type ImdsBrandProps = {
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
      aria-label="IMDS TECH"
      style={{ display: 'block', maxWidth: '100%', height: 'auto', flex: '0 0 auto' }}
    >
      <defs>
        <linearGradient id="imdsBrandTeal" x1="16" y1="16" x2="150" y2="106" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#12c7a7"/>
          <stop offset="0.55" stopColor="#09b5a7"/>
          <stop offset="1" stopColor="#078c9b"/>
        </linearGradient>
        <linearGradient id="imdsBrandNavy" x1="112" y1="28" x2="174" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#173746"/>
          <stop offset="1" stopColor="#102b3a"/>
        </linearGradient>
      </defs>

      <g transform="translate(0 6) scale(.112)">
        <path fill="url(#imdsBrandTeal)" d="M188 407c0-42 21-81 56-105L463 154c34-23 78-23 112 0l132 89-119 78-75-51-135 91h70v121H343v-49h-99c-31 0-56-25-56-56v30Zm0 214c0 42 21 81 56 105l219 148c34 23 78 23 112 0l132-89-119-78-75 51-65-44V593H343v31h-99c-31 0-56 25-56 56v-59Z"/>
        <path fill="url(#imdsBrandNavy)" d="M604 336 736 247l67 45c35 24 56 63 56 105v230c0 42-21 81-56 105l-67 45-148-100V593h94v-51h-69l55-55-80-80 16-71Z"/>
        <path fill="url(#imdsBrandTeal)" d="M577 325c25 59 58 112 100 157h-89V333l-11-8Z"/>
        <g fill="#fff">
          <path d="M448 328h128v116h96v-36l148 104-148 104v-36h-96v130l-64 44-64-44V580H344V444h104V328Z"/>
          <path d="M512 264 421 329h182l-91-65Z"/>
        </g>
        <g fill="url(#imdsBrandTeal)">
          <rect x="151" y="433" width="121" height="61" rx="30"/>
          <circle cx="296" cy="463" r="31"/>
          <rect x="151" y="512" width="111" height="61" rx="30"/>
          <circle cx="286" cy="542" r="31"/>
          <rect x="151" y="591" width="121" height="61" rx="30"/>
          <circle cx="296" cy="621" r="31"/>
        </g>
      </g>

      <text x="118" y="54" fill="var(--imds-logo-main, #102b3a)" fontFamily="Inter, Arial, sans-serif" fontSize="39" fontWeight="800" letterSpacing="1.3">IMDS</text>
      <text x="250" y="54" fill="#12b8a5" fontFamily="Inter, Arial, sans-serif" fontSize="39" fontWeight="800" letterSpacing="1.1">TECH</text>
      <text x="120" y="82" fill="var(--imds-muted, #78909a)" fontFamily="Inter, Arial, sans-serif" fontSize="10.5" fontWeight="600" letterSpacing="3.5">INTEGRATED META DIGITAL SYSTEMS</text>
    </svg>
  </div>;
}
