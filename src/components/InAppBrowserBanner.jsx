import { useEffect, useState } from 'react'

// In-app browsers (Telegram, Instagram, X, Facebook, TikTok…) run a stripped
// webview where no Solana wallet can inject a provider or receive a sign
// request — so launches/swaps silently hang. Detect that and tell the user
// how to escape, instead of leaving the button stuck on "IGNITING".
function detectInApp() {
  if (typeof navigator === 'undefined') return null
  // A wallet provider is present (extension, or Phantom/Solflare in-app
  // browser) → signing works, never warn.
  if (window.solana || window.phantom?.solana || window.solflare) return null
  const ua = navigator.userAgent || ''
  if (window.TelegramWebviewProxy !== undefined || /Telegram/i.test(ua)) return 'Telegram'
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/\bFBAN|\bFBAV|FB_IAB/i.test(ua)) return 'Facebook / Messenger'
  if (/Twitter/i.test(ua)) return 'X'
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return 'TikTok'
  if (/\bLine\//i.test(ua)) return 'LINE'
  if (/Snapchat/i.test(ua)) return 'Snapchat'
  return null
}

export default function InAppBrowserBanner() {
  const [app, setApp] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const check = () => setApp(detectInApp())
    check()
    // injected providers can appear a beat after load
    const t = setTimeout(check, 800)
    return () => clearTimeout(t)
  }, [])

  if (!app || dismissed) return null

  const url = 'https://infinitydex.pro'
  const copy = async () => {
    try { await navigator.clipboard.writeText(url) } catch {
      const el = document.createElement('textarea'); el.value = url
      document.body.appendChild(el); el.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(el)
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="iab-banner" role="alert">
      <button className="iab-x" onClick={() => setDismissed(true)} aria-label="Dismiss">×</button>
      <div className="iab-title">⚠️ You're inside the {app} browser</div>
      <p className="iab-body">
        Crypto wallets can't sign here. To launch or swap, open this site in
        {' '}<strong>Safari / Chrome</strong>, or inside your <strong>Phantom / Solflare</strong> wallet's browser.
      </p>
      <button className="iab-copy" onClick={copy}>{copied ? '✓ Link copied' : 'Copy infinitydex.pro'}</button>
    </div>
  )
}
