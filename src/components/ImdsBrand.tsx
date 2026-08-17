type ImdsBrandProps = {
  compact?: boolean;
  className?: string;
};

export default function ImdsBrand({ compact = false, className = '' }: ImdsBrandProps) {
  const logoWidth = compact ? 220 : 246;
  return <div className={`beles-brand${compact ? ' beles-brand--compact' : ''}${className ? ` ${className}` : ''}`}>
    <svg
      width={logoWidth}
      height={compact ? 68 : 76}
      viewBox="0 0 455 120"
      role="img"
      aria-label="BELES by IMDS TECH"
    >
      <defs>
        <linearGradient id="belesBrandTeal" x1="14" y1="14" x2="98" y2="108" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--beles-mark-teal-1, #29dacb)"/>
          <stop offset="0.58" stopColor="var(--beles-mark-teal-2, #18c2b2)"/>
          <stop offset="1" stopColor="var(--beles-mark-teal-3, #0a929d)"/>
        </linearGradient>
        <linearGradient id="belesArrowGradient" x1="26" y1="82" x2="94" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--beles-arrow-tail, #b9dfe0)"/>
          <stop offset="1" stopColor="var(--beles-arrow, #ffffff)"/>
        </linearGradient>
      </defs>

      <g className="beles-brand__mark" transform="translate(3 2)">
        <path className="beles-brand__core" d="M54 7 99 33v52l-45 26L9 85V33L54 7Z" fill="var(--beles-mark-core, #092632)" stroke="var(--beles-mark-stroke, #42d8c7)" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M17 59V38L54 17l36 21-13 8-23-13-24 14v20L17 59Z" fill="url(#belesBrandTeal)"/>
        <path d="m69 26 13 8-13 8-13-8 13-8Z" fill="var(--beles-arrow-edge, #ffffff)"/>
        <path d="m18 76 36 21 28-17 11 8-39 23-36-21V76Z" fill="url(#belesBrandTeal)" opacity="0.86"/>
        <g fill="url(#belesBrandTeal)">
          <path d="M26 72h10v17l-10-6V72Z"/>
          <path d="M42 61h10v37l-10-6V61Z"/>
          <path d="M58 49h10v42l-10 6V49Z"/>
        </g>
        <path className="beles-brand__arrow" d="M24 77 72 45l-8-8 30 4-5 29-8-9-50 33-7-17Z" fill="url(#belesArrowGradient)" stroke="var(--beles-arrow-edge, #ffffff)" strokeWidth="1.2" strokeLinejoin="round"/>
      </g>

      <text className="beles-brand__wordmark" x="126" y="55" fill="var(--beles-wordmark, #f7fbfc)" fontFamily="Inter, Arial, sans-serif" fontSize="39" fontWeight="800" letterSpacing="1.8">BELES</text>
      <text className="beles-brand__by" x="127" y="83" fill="var(--beles-by, #91a9ae)" fontFamily="Inter, Arial, sans-serif" fontSize="16" fontWeight="600">by</text>
      <text className="beles-brand__imds" x="151" y="83" fill="var(--beles-imds, #f4fafb)" fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="800" letterSpacing="0.7">IMDS</text>
      <text className="beles-brand__tech" x="205" y="83" fill="var(--beles-tech, #24c7b6)" fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="800" letterSpacing="0.7">TECH</text>
    </svg>
  </div>;
}
