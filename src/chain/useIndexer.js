import { useEffect, useState } from 'react'
import { INDEXER_API } from './config.js'

/** Poll a JSON endpoint on the indexer. Returns { data, ok }. */
export function useIndexer(path, { interval = 15_000 } = {}) {
  const [data, setData] = useState(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (!path) return
    let alive = true
    const load = () =>
      fetch(`${INDEXER_API}${path}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => { if (alive) { setData(d); setOk(true) } })
        .catch(() => { if (alive) setOk(false) })
    load()
    const id = setInterval(load, interval)
    return () => { alive = false; clearInterval(id) }
  }, [path, interval])

  return { data, ok }
}
