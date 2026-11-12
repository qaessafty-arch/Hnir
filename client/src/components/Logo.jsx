import { useI18n } from '../i18n';

/**
 * The official Darwaza Private School logo — the original supplied image, never redrawn.
 * Served at several pre-scaled resolutions (same artwork, same proportions) for sharp rendering.
 */
export default function Logo({ size = 48, plate = false, className = '' }) {
  const { t } = useI18n();
  const img = (
    <img
      className={`logo ${className}`}
      src="/brand/darwaza-logo-256.webp"
      srcSet="/brand/darwaza-logo-160.webp 160w, /brand/darwaza-logo-256.webp 256w, /brand/darwaza-logo-512.webp 512w"
      sizes={`${size}px`}
      width={size}
      height={Math.round(size * (1277 / 1296))}
      alt={t('logoAlt')}
      decoding="async"
    />
  );
  return plate ? <span className="logo-plate">{img}</span> : img;
}
