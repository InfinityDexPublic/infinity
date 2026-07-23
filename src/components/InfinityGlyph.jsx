let uid = 0

export default function InfinityGlyph({ size = 24, strokeWidth = 3.4, className = '' }) {
  const id = `inf-grad-${uid++}`
  return (
    <svg
      className={className}
      width={size * 2}
      height={size}
      viewBox="0 0 48 24"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7B2BFF" />
          <stop offset="0.5" stopColor="#E9E4FF" />
          <stop offset="1" stopColor="#00F0FF" />
        </linearGradient>
      </defs>
      <path
        d="M14 12 C14 6.5 21 6.5 24 12 C27 17.5 34 17.5 34 12 C34 6.5 27 6.5 24 12 C21 17.5 14 17.5 14 12 Z"
        stroke={`url(#${id})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  )
}
