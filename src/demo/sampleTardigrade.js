import sample from '../../data/sample_tardigrade.json'

// Renders the synthetic tardigrade connectome into a nerve-map image
// using the three layer colors the simulator's mask sampler expects
// (brain / ventral nerve cord / outer nerves).

const COLORS = {
  brain: '#f08a8a',
  ventral_nerve: '#7fb7ee',
  outer_nerve: '#e8c76b',
}

const WIDTH = 640
const HEIGHT = 760
const PAD = 48

function projector(points) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min(
    (WIDTH - PAD * 2) / (maxX - minX),
    (HEIGHT - PAD * 2) / (maxY - minY),
  )
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return (p) => [
    WIDTH / 2 + (p.x - cx) * scale,
    HEIGHT / 2 - (p.y - cy) * scale, // world +y is up, canvas +y is down
  ]
}

let cached = null

export function buildSampleOrganism() {
  if (cached) return cached
  const { points, connections } = sample
  const project = projector(points)
  const byId = new Map(points.map((p) => [p.id, p]))
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // tracts first, colored by the pre-synaptic region
  ctx.lineWidth = 10
  for (const conn of connections) {
    const pre = byId.get(conn.pre)
    const post = byId.get(conn.post)
    if (!pre || !post) continue
    const [x1, y1] = project(pre)
    const [x2, y2] = project(post)
    ctx.strokeStyle = COLORS[pre.type] || COLORS.brain
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // somata on top
  for (const p of points) {
    const [x, y] = project(p)
    ctx.fillStyle = COLORS[p.type] || COLORS.brain
    ctx.beginPath()
    ctx.arc(x, y, p.type === 'brain' ? 14 : 12, 0, Math.PI * 2)
    ctx.fill()
  }

  cached = {
    drawing: canvas.toDataURL('image/png'),
    background: '',
    length: 500,
    depthPercent: 12,
    neuronCount: 600,
    drawingWidth: WIDTH,
    drawingHeight: HEIGHT,
    fileName: `${sample.name}.png`,
    sampleLabel: 'Hypsibius exemplaris (synthetic connectome)',
  }
  return cached
}
