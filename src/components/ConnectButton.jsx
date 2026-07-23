import { useState, useRef, useEffect } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import Sol from './SolLogo.jsx'

const short = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`

export default function ConnectButton() {
  const { publicKey, wallets, select, connect, disconnect, connecting, wallet } = useWallet()
  const { connection } = useConnection()
  const [view, setView] = useState('closed') // 'closed' | 'account' | 'wallets'
  const [balance, setBalance] = useState(null)
  const ref = useRef(null)
  // only auto-connect after an explicit user pick (never a restored wallet)
  const userPicked = useRef(false)

  useEffect(() => {
    const away = (e) => ref.current && !ref.current.contains(e.target) && setView('closed')
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [])

  useEffect(() => {
    if (userPicked.current && wallet && !publicKey && !connecting) {
      userPicked.current = false
      connect().catch(() => {})
    }
  }, [wallet, publicKey, connecting, connect])

  useEffect(() => {
    let alive = true
    setBalance(null)
    if (!publicKey) return
    const load = () => connection.getBalance(publicKey).then((l) => alive && setBalance(l / 1e9)).catch(() => {})
    load()
    const t = setInterval(load, 20_000)
    return () => { alive = false; clearInterval(t) }
  }, [publicKey, connection])

  const pick = (name) => {
    setView('closed')
    if (wallet?.adapter.name === name && !publicKey) { connect().catch(() => {}); return }
    userPicked.current = true
    select(name)
  }
  const switchTo = async (name) => {
    setView('closed')
    if (wallet?.adapter.name === name) return
    try { await disconnect() } catch { /* noop */ }
    userPicked.current = true
    select(name)
  }

  const WalletList = ({ onPick }) => (
    <ul className="wallet-menu glass">
      {wallets.filter((w) => w.readyState === 'Installed' || w.readyState === 'Loadable').length === 0 && (
        <li className="wallet-empty">No wallet detected — install Phantom</li>
      )}
      {wallets.map((w) => (
        <li key={w.adapter.name}>
          <button onClick={() => onPick(w.adapter.name)}>
            {w.adapter.icon && <img src={w.adapter.icon} alt="" width={18} height={18} />}
            {w.adapter.name}
            <span className="wallet-state">
              {wallet?.adapter.name === w.adapter.name && publicKey ? 'current' : w.readyState === 'Installed' ? 'detected' : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )

  // ---------- connected ----------
  if (publicKey) {
    return (
      <div className="connect-wrap" ref={ref}>
        <button className="wallet-pill" onClick={() => setView(view === 'closed' ? 'account' : 'closed')}>
          <span className="net-dot" />
          <span className="wp-addr">{short(publicKey.toBase58())}</span>
          <span className="wp-bal">{balance != null ? balance.toFixed(2) : '…'}&nbsp;<Sol size={10} /></span>
        </button>
        {view === 'account' && (
          <ul className="wallet-menu glass">
            <li className="wm-bal"><span>BALANCE</span><strong>{balance != null ? balance.toFixed(4) : '…'}&nbsp;<Sol size={11} /></strong></li>
            <li><button onClick={() => setView('wallets')}>Switch wallet</button></li>
            <li><button className="wm-danger" onClick={() => { disconnect(); setView('closed') }}>Disconnect</button></li>
          </ul>
        )}
        {view === 'wallets' && <WalletList onPick={switchTo} />}
      </div>
    )
  }

  // ---------- disconnected ----------
  return (
    <div className="connect-wrap" ref={ref}>
      <button className="connect-btn" onClick={() => setView(view === 'wallets' ? 'closed' : 'wallets')} disabled={connecting}>
        {connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
      </button>
      {view === 'wallets' && <WalletList onPick={pick} />}
    </div>
  )
}
