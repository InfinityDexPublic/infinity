import * as THREE from 'three'

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f))
  const b = Math.min(255, Math.max(0, (n & 255) * f))
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

/* Flat token coin: colored disc, glossy top light, white rim, symbol glyph */
export function makeCoinTexture(color, glyph) {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const cx = size / 2

  const body = g.createLinearGradient(0, 0, 0, size)
  body.addColorStop(0, shade(color, 1.35))
  body.addColorStop(0.55, color)
  body.addColorStop(1, shade(color, 0.55))
  g.fillStyle = body
  g.beginPath()
  g.arc(cx, cx, cx - 14, 0, Math.PI * 2)
  g.fill()

  // glossy highlight
  const gloss = g.createRadialGradient(cx, cx * 0.55, 8, cx, cx * 0.65, cx * 0.85)
  gloss.addColorStop(0, 'rgba(255,255,255,0.55)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gloss
  g.beginPath()
  g.arc(cx, cx, cx - 14, 0, Math.PI * 2)
  g.fill()

  // rim
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = 8
  g.beginPath()
  g.arc(cx, cx, cx - 18, 0, Math.PI * 2)
  g.stroke()

  // glyph
  g.fillStyle = '#ffffff'
  g.shadowColor = 'rgba(0,0,0,0.35)'
  g.shadowBlur = 10
  g.font = `600 ${size * 0.46}px "Segoe UI Symbol", "Arial", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(glyph, cx, cx + size * 0.02)

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/* Soft radial halo, tinted via sprite material color */
export function makeGlowTexture() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.28)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
