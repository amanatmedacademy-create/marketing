type ImdsBrandProps = {
  compact?: boolean;
  className?: string;
};

export default function ImdsBrand({ compact = false, className = '' }: ImdsBrandProps) {
  return <div className={className} style={{ display: 'flex', alignItems: 'center', gap: compact ? 9 : 12, minWidth: 0 }}>
    <img
      src="/imds-logo.svg"
      alt="IMDS"
      style={{ width: compact ? 38 : 48, height: compact ? 38 : 48, objectFit: 'contain', flex: '0 0 auto' }}
    />
    <div style={{ display: 'grid', lineHeight: 1.05, minWidth: 0 }}>
      <strong style={{ fontSize: compact ? '.82rem' : '.9rem', letterSpacing: '.055em', color: '#f8fafc' }}>IMDS</strong>
      <span style={{ marginTop: 4, fontSize: compact ? '.63rem' : '.7rem', letterSpacing: '.045em', color: '#7d91aa' }}>Marketing</span>
    </div>
  </div>;
}
