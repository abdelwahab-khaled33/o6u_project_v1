export const O6U_LOGO_SRC = '/o6u-logo.png';

const LOGO_HEIGHTS = { sm: 32, md: 44, lg: 60 } as const;

export type O6ULogoSize = keyof typeof LOGO_HEIGHTS;

export function O6ULogo({ size = 'md', imageMissing = false }: { size?: O6ULogoSize; imageMissing?: boolean }) {
  const height = LOGO_HEIGHTS[size];
  if (imageMissing) {
    return (
      <svg height={height} viewBox="0 0 64 64" role="img" aria-label="October 6 University logo" className="shrink-0">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#455B8A" />
        <text x="32" y="41" textAnchor="middle" fill="#FFFFFF" fontSize="22" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">O6U</text>
        <rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="#F2842F" strokeWidth="3" />
      </svg>
    );
  }
  return (
    <img
      src={O6U_LOGO_SRC}
      alt="October 6 University logo"
      height={height}
      className="w-auto shrink-0 object-contain"
      style={{ height }}
    />
  );
}
