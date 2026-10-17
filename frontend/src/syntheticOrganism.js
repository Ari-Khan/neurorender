export function makeSyntheticOrganism(W = 960, H = 640) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, 40, W * 0.5, H * 0.5, W * 0.7)
  bgGrad.addColorStop(0, '#141a28')
  bgGrad.addColorStop(1, '#070a12')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  const cx = W * 0.52
  const cy = H * 0.52
  const rx = W * 0.3
  const ry = H * 0.26

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, -0.08, 0, Math.PI * 2)
  ctx.clip()

  const bodyGrad = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 10, cx, cy, rx)
  bodyGrad.addColorStop(0, 'rgba(165, 175, 195, 0.95)')
  bodyGrad.addColorStop(0.6, 'rgba(110, 120, 145, 0.9)')
  bodyGrad.addColorStop(1, 'rgba(70, 78, 100, 0.9)')
  ctx.fillStyle = bodyGrad
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2)

  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2
    const rr = Math.sqrt(rand())
    const px = cx + Math.cos(a) * rr * rx
    const py = cy + Math.sin(a) * rr * ry
    const s = 1 + rand() * 3
    ctx.fillStyle = `rgba(${140 + rand() * 60}, ${150 + rand() * 60}, ${170 + rand() * 60}, ${0.05 + rand() * 0.12})`
    ctx.beginPath()
    ctx.arc(px, py, s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  ctx.strokeStyle = 'rgba(90, 100, 125, 0.85)'
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx + 6, ry + 6, -0.08, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(150, 160, 185, 0.5)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(cx - rx * 0.35, cy)
  ctx.bezierCurveTo(cx + rx * 0.1, cy + 14, cx + rx * 0.5, cy - 10, cx + rx * 0.95, cy + 4)
  ctx.stroke()

  const eye = (ex, ey, er) => {
    const g = ctx.createRadialGradient(ex, ey, 1, ex, ey, er)
    g.addColorStop(0, '#f2f8ff')
    g.addColorStop(0.55, '#b8d8f0')
    g.addColorStop(1, 'rgba(90, 130, 170, 0.35)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(ex, ey, er, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(20, 30, 50, 0.85)'
    ctx.beginPath()
    ctx.arc(ex, ey, er * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }
  eye(cx - rx * 0.72, cy - ry * 0.38, 22)
  eye(cx - rx * 0.78, cy + ry * 0.18, 18)

  return c
}
