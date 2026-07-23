import { useEffect, useState } from 'react'
import { INDEXER_API } from './config.js'

/** Live SOL/USD from the indexer (server-side cached). 0 until loaded. */
export function useSolPrice() {
  const [usd, setUsd] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`${INDEXER_API}/solprice`)
        .then((r) => r.json())
        .then((d) => { if (alive && d.usd) setUsd(d.usd) })
        .catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return usd
}
