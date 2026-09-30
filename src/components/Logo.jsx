import { BRAND } from '../brand.js'

/*
  Central Zoom17 wordmark renderer. The supplied transparent brand asset is used
  everywhere; the vector fallback remains available if that asset is removed.
*/
export default function Logo({ className = '', invert = false, height = 26, title = BRAND.name }) {
  const navy = invert ? BRAND.invertedNavy : BRAND.navy
  const blue = invert ? BRAND.invertedBlue : BRAND.blue

  // An exact export, when one has been supplied, wins over the drawn wordmark.
  // When no separate inverted export exists, give the original a light contrast
  // plate on dark surfaces instead of silently switching to the drawn fallback.
  const src = (invert && BRAND.logoSrcInverted) || BRAND.logoSrc
  if (src) {
    return (
      <div className={`flex items-center ${invert && !BRAND.logoSrcInverted ? 'rounded-xl bg-white px-2.5 py-1.5 shadow-sm' : ''} ${className}`}>
        <img src={src} alt={title} height={height} style={{ height }} className="block w-auto select-none" />
      </div>
    )
  }

  // Split a trailing number off the name so it can carry the accent colour.
  const [, word, digits] = BRAND.name.match(/^(.*?)(\d*)$/)

  return (
    <div className={`flex items-center ${className}`}>
      <svg
        viewBox="0 0 300 92"
        height={height}
        role="img"
        aria-label={title}
        className="block w-auto select-none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{title}</title>
        <text
          x="8"
          y="62"
          fontFamily="Inter, system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="64"
          fontWeight="800"
          letterSpacing="-3"
          fill={navy}
        >
          {word}
          {digits && <tspan fill={blue}>{digits}</tspan>}
        </text>
        {/* the sweep echoes the connective 'join' idea and anchors the wordmark */}
        <path
          d="M10 80 C 52 92, 150 94, 232 76"
          stroke={blue}
          strokeWidth="11"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  )
}
