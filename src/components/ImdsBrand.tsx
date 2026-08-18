type ImdsBrandProps = {
  compact?: boolean;
  className?: string;
};

export default function ImdsBrand({ compact = false, className = '' }: ImdsBrandProps) {
  return <div className={`beles-brand${compact ? ' beles-brand--compact' : ''}${className ? ` ${className}` : ''}`}>
    <picture className="beles-brand__picture">
      <img className="beles-brand__image beles-brand__image--light" src="/beles-logo-light.svg" alt="BELES by IMDS TECH" />
      <img className="beles-brand__image beles-brand__image--dark" src="/beles-logo-dark.svg" alt="" aria-hidden="true" />
    </picture>
  </div>;
}
