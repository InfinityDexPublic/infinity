import { useState } from 'react'
import { useTokenMeta } from '../chain/useTokenMeta.js'
import { deriveMeta } from '../chain/display.js'

// Avatar + symbol (+ optional name) resolved from on-chain metadata, cached.
// Falls back to the deterministic placeholder while loading / if absent.
export default function TokenTag({ mint, size = 26, showName = false, suffix = null, className = '' }) {
  const [broken, setBroken] = useState(false)
  const meta = useTokenMeta(mint)
  const fb = deriveMeta(mint)
  const symbol = meta?.symbol || fb.symbol
  const name = meta?.name && meta.name !== 'Token' ? meta.name : ''
  const image = meta?.image
  const color = meta?.color || fb.color
  return (
    <span className={`token-tag ${className}`}>
      {image && !broken
        ? <img className="tt-av" style={{ width: size, height: size }} src={image} alt="" onError={() => setBroken(true)} />
        : <span className="tt-av ph" style={{ width: size, height: size, background: color }}>{(symbol || '?')[0]}</span>}
      <span className="tt-id">
        <span className="tt-sym">{symbol}{suffix}</span>
        {showName && <span className="tt-name">{name || '—'}</span>}
      </span>
    </span>
  )
}
