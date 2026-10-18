import { useEffect, useRef, useState } from 'react'

const TOOLS = [
  { id: 'brain', label: 'Brain outline', color: '#f08a8a' },
  { id: 'cord', label: 'Ventral nerve cord', color: '#7fb7ee' },
  { id: 'nerves', label: 'Outer nerves', color: '#e8c76b' },
]

const THICKNESSES = [
  { id: 'fine', label: 'Fine', value: 0.006 },
  { id: 'medium', label: 'Medium', value: 0.012 },
  { id: 'broad', label: 'Broad', value: 0.022 },
]

const MAX_IMAGE_SIZE = 1600

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function validateDrawing(canvas) {
  if (!canvas) return { valid: false, message: 'Upload an image to begin.' }

  const context = canvas.getContext('2d', { willReadFrequently: true })
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  const colors = TOOLS.map((tool) => tool.color.match(/\w\w/g).map((value) => parseInt(value, 16)))
  const pixels = new Uint8Array(width * height)
  const counts = [0, 0, 0]

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 30) continue
    const color = [data[i], data[i + 1], data[i + 2]]
    let nearest = 0
    let nearestDistance = distance(color, colors[0])
    for (let colorIndex = 1; colorIndex < colors.length; colorIndex += 1) {
      const nextDistance = distance(color, colors[colorIndex])
      if (nextDistance < nearestDistance) {
        nearest = colorIndex
        nearestDistance = nextDistance
      }
    }
    if (nearestDistance < 110) {
      pixels[i / 4] = nearest + 1
      counts[nearest] += 1
    }
  }

  const missing = TOOLS.filter((_, index) => counts[index] === 0)
  if (missing.length > 0) {
    return {
      valid: false,
      message: `Add ${missing.map((tool) => tool.label.toLowerCase()).join(', ')}.`,
    }
  }

  const first = pixels.findIndex(Boolean)
  const queue = [first]
  const visited = new Uint8Array(pixels.length)
  visited[first] = 1
  let reached = 0
  const directions = [-1, 0, 1]

  while (queue.length > 0) {
    const index = queue.shift()
    reached += 1
    const x = index % width
    const y = Math.floor(index / width)
    for (const offsetY of directions) {
      for (const offsetX of directions) {
        if (offsetX === 0 && offsetY === 0) continue
        const nextX = x + offsetX
        const nextY = y + offsetY
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
        const next = nextY * width + nextX
        if (pixels[next] && !visited[next]) {
          visited[next] = 1
          queue.push(next)
        }
      }
    }
  }

  const drawn = counts.reduce((sum, count) => sum + count, 0)
  if (reached !== drawn) {
    return { valid: false, message: 'Connect all three colors into one continuous map.' }
  }

  return { valid: true, message: 'Map ready to accept.' }
}

export default function OrganismPanel({ initialOrganism, onClose }) {
  const imageCanvasRef = useRef(null)
  const drawingCanvasRef = useRef(null)
  const canvasWrapRef = useRef(null)
  const fileInputRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef(null)
  const historyRef = useRef([])
  const historyIndexRef = useRef(-1)
  const [imageLoaded, setImageLoaded] = useState(Boolean(initialOrganism))
  const [imageSource, setImageSource] = useState(initialOrganism?.background || '')
  const [drawingSource, setDrawingSource] = useState(initialOrganism?.drawing || '')
  const [imageSize, setImageSize] = useState({
    width: initialOrganism?.drawingWidth || 0,
    height: initialOrganism?.drawingHeight || 0,
  })
  const [activeTool, setActiveTool] = useState(TOOLS[0].id)
  const [thickness, setThickness] = useState(THICKNESSES[1].id)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [validation, setValidation] = useState(initialOrganism
    ? { valid: true, message: 'Map ready to accept.' }
    : { valid: false, message: 'Upload an image to begin.' })
  const [fileName, setFileName] = useState(initialOrganism?.fileName || '')
  const [acceptedImage, setAcceptedImage] = useState('')
  const [acceptedPreview, setAcceptedPreview] = useState('')
  const [acceptedBackground, setAcceptedBackground] = useState('')
  const [acceptedSize, setAcceptedSize] = useState({ width: 0, height: 0 })
  const [depthPercent, setDepthPercent] = useState(String(initialOrganism?.depthPercent ?? 10))
  const [neuronCount, setNeuronCount] = useState(String(initialOrganism?.neuronCount ?? 600))
  const [organismLength, setOrganismLength] = useState(String(initialOrganism?.length ?? 500))

  const activeColor = TOOLS.find((tool) => tool.id === activeTool)?.color || '#000'
  const displayScale = availableWidth > 0 ? availableWidth / imageSize.width : 1

  const validate = () => setValidation(validateDrawing(drawingCanvasRef.current))

  const acceptImage = () => {
    const imageCanvas = imageCanvasRef.current
    const drawingCanvas = drawingCanvasRef.current
    if (!imageCanvas || !drawingCanvas || !validation.valid) return
    const merged = document.createElement('canvas')
    merged.width = imageCanvas.width
    merged.height = imageCanvas.height
    const mergedContext = merged.getContext('2d')
    mergedContext.drawImage(imageCanvas, 0, 0)
    mergedContext.drawImage(drawingCanvas, 0, 0)
    setAcceptedImage(drawingCanvas.toDataURL('image/png'))
    setAcceptedPreview(merged.toDataURL('image/png'))
    setAcceptedBackground(imageCanvas.toDataURL('image/png'))
    setAcceptedSize({ width: drawingCanvas.width, height: drawingCanvas.height })
  }

  const loadImage = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(image.naturalWidth, image.naturalHeight))
      const sourceWidth = Math.max(1, Math.round(image.naturalWidth * scale))
      const sourceHeight = Math.max(1, Math.round(image.naturalHeight * scale))
      const width = sourceHeight > sourceWidth ? sourceHeight : sourceWidth
      const height = sourceHeight > sourceWidth ? sourceWidth : sourceHeight
      setImageSource(url)
      setDrawingSource('')
      setImageSize({ width, height })
      setFileName(file.name)
      setImageLoaded(true)
      setValidation({ valid: false, message: 'Trace all three map layers, then connect them.' })
    }
    image.src = url
  }

  useEffect(() => {
    if (!imageLoaded || !imageSource) return undefined
    const imageCanvas = imageCanvasRef.current
    const drawingCanvas = drawingCanvasRef.current
    if (!imageCanvas || !drawingCanvas) return undefined

    imageCanvas.width = imageSize.width
    imageCanvas.height = imageSize.height
    drawingCanvas.width = imageSize.width
    drawingCanvas.height = imageSize.height
    const image = new Image()
    image.onload = () => {
      const context = imageCanvas.getContext('2d')
      const drawingContext = drawingCanvas.getContext('2d', { willReadFrequently: true })
      context.clearRect(0, 0, imageSize.width, imageSize.height)
      drawingContext.clearRect(0, 0, imageSize.width, imageSize.height)
      const portrait = image.naturalHeight > image.naturalWidth
      if (portrait) {
        context.save()
        context.translate(imageSize.width, 0)
        context.rotate(Math.PI / 2)
        context.drawImage(image, 0, 0, imageSize.height, imageSize.width)
        context.restore()
      } else {
        context.drawImage(image, 0, 0, imageSize.width, imageSize.height)
      }
      if (drawingSource) {
        const drawing = new Image()
        drawing.onload = () => drawingContext.drawImage(drawing, 0, 0, imageSize.width, imageSize.height)
        drawing.src = drawingSource
      }
    }
    image.src = imageSource

    return () => {
      image.onload = null
      URL.revokeObjectURL(imageSource)
    }
  }, [imageLoaded, imageSize, imageSource, drawingSource])

  useEffect(() => {
    if (!canvasWrapRef.current) return undefined
    const updateWidth = () => {
      if (canvasWrapRef.current) setAvailableWidth(canvasWrapRef.current.clientWidth)
    }
    const observer = new ResizeObserver(updateWidth)
    observer.observe(canvasWrapRef.current)
    updateWidth()
    return () => observer.disconnect()
  }, [imageLoaded])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const saveHistory = () => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const data = canvas.toDataURL()
    const index = historyIndexRef.current
    historyRef.current = historyRef.current.slice(0, index + 1)
    historyRef.current.push(data)
    if (historyRef.current.length > 50) {
      historyRef.current.shift()
    }
    historyIndexRef.current = historyRef.current.length - 1
  }

  const restoreHistory = (index) => {
    const canvas = drawingCanvasRef.current
    if (!canvas || index < 0 || index >= historyRef.current.length) return
    const data = historyRef.current[index]
    const context = canvas.getContext('2d')
    const image = new Image()
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      validate()
    }
    image.src = data
    historyIndexRef.current = index
  }

  const undo = () => {
    restoreHistory(historyIndexRef.current - 1)
  }

  const redo = () => {
    restoreHistory(historyIndexRef.current + 1)
  }

  const pointFromEvent = (event) => {
    const canvas = drawingCanvasRef.current
    const bounds = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(
        canvas.width,
        ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      )),
      y: Math.max(0, Math.min(
        canvas.height,
        ((event.clientY - bounds.top) / bounds.height) * canvas.height,
      )),
    }
  }

  const draw = (event) => {
    if (!drawingRef.current || !imageLoaded) return
    const point = pointFromEvent(event)
    const context = drawingCanvasRef.current.getContext('2d', { willReadFrequently: true })
    const selectedThickness = THICKNESSES.find((item) => item.id === thickness)
    context.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over'
    context.strokeStyle = activeColor
    context.lineWidth = Math.max(4, drawingCanvasRef.current.width * selectedThickness.value)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    const last = lastPointRef.current || point
    context.moveTo(last.x, last.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    lastPointRef.current = point
    validate()
  }

  return (
    <div className="organism-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="organism-panel" role="dialog" aria-modal="true" aria-label="New organism">
        <div className="organism-panel-head">
          <div>
            <h2>New organism</h2>
            <p>Upload a nerve map, then trace its three connected layers.</p>
          </div>
          <button type="button" className="organism-panel-close" aria-label="Close new organism panel" onClick={onClose}>×</button>
        </div>

        {acceptedImage ? (
          <div className="organism-review">
            <div className="organism-image-preview">
              <img src={acceptedPreview} alt="Annotated nerve map" />
            </div>
            <div className="organism-fields">
              <label>
                <span>Organism length (μm)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={organismLength}
                  onChange={(event) => setOrganismLength(event.target.value)}
                />
              </label>
              <label>
                <span>Organism depth (% of length)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={depthPercent}
                  onChange={(event) => setDepthPercent(event.target.value)}
                />
              </label>
              <label>
                <span>Total neurons</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={neuronCount}
                  onChange={(event) => setNeuronCount(event.target.value)}
                  placeholder="Enter count"
                />
              </label>
            </div>
            <div className="organism-review-actions">
              <button type="button" className="change-image-btn" onClick={() => {
                setAcceptedImage('')
                setAcceptedPreview('')
                setAcceptedBackground('')
                setAcceptedSize({ width: 0, height: 0 })
              }}>
                Edit drawing
              </button>
              <button
                type="button"
                className="accept-organism-btn"
                disabled={!neuronCount || Number(neuronCount) < 1}
                onClick={() => onClose({
                  drawing: acceptedImage,
                  background: acceptedBackground,
                  length: Number(organismLength),
                  depthPercent: Number(depthPercent),
                  neuronCount: Number(neuronCount),
                  drawingWidth: acceptedSize.width,
                  drawingHeight: acceptedSize.height,
                  fileName,
                })}
              >
                Done
              </button>
            </div>
          </div>
        ) : !imageLoaded ? (
          <button type="button" className="image-upload-box" onClick={() => fileInputRef.current?.click()}>
            <strong>Choose a nerve map image</strong>
            <span>PNG, JPG, or WEBP</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => loadImage(event.target.files[0])}
            />
          </button>
        ) : (
          <>
            <div className="organism-workspace">
              <div className="canvas-wrap" ref={canvasWrapRef}>
                <div
                  className="canvas-stage"
                  style={{ width: imageSize.width * displayScale, height: imageSize.height * displayScale }}
                >
                  <canvas
                    ref={imageCanvasRef}
                    style={{ width: imageSize.width * displayScale, height: imageSize.height * displayScale }}
                  />
                  <canvas
                    ref={drawingCanvasRef}
                    style={{ width: imageSize.width * displayScale, height: imageSize.height * displayScale }}
                  onPointerDown={(event) => {
                    drawingRef.current = true
                    lastPointRef.current = pointFromEvent(event)
                    event.currentTarget.setPointerCapture(event.pointerId)
                    draw(event)
                  }}
                  onPointerMove={draw}
                  onPointerUp={() => {
                    drawingRef.current = false
                    lastPointRef.current = null
                    saveHistory()
                    validate()
                  }}
                  onPointerCancel={() => {
                    drawingRef.current = false
                    lastPointRef.current = null
                    saveHistory()
                    validate()
                  }}
                  />
                </div>
              </div>
              <aside className="drawing-tools">
                <span className="tool-title">Trace layers</span>
                {TOOLS.map((tool) => (
                  <button
                    type="button"
                    className={`drawing-tool ${activeTool === tool.id ? 'active' : ''}`}
                    key={tool.id}
                    onClick={() => setActiveTool(tool.id)}
                  >
                    <i style={{ background: tool.color }} />
                    {tool.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`drawing-tool ${activeTool === 'eraser' ? 'active' : ''}`}
                  onClick={() => setActiveTool('eraser')}
                >
                  <i className="eraser-swatch" />
                  Eraser
                </button>
                <span className="tool-title">Brush size</span>
                <div className="thickness-tools">
                  {THICKNESSES.map((item) => (
                    <button
                      type="button"
                      className={thickness === item.id ? 'active' : ''}
                      key={item.id}
                      onClick={() => setThickness(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="clear-drawing-btn" onClick={() => {
                  const canvas = drawingCanvasRef.current
                  if (!canvas) return
                  const context = canvas.getContext('2d')
                  context.clearRect(0, 0, canvas.width, canvas.height)
                  saveHistory()
                  validate()
                }}>
                  Clear drawing
                </button>
              </aside>
            </div>
            <div className={`validation ${validation.valid ? 'valid' : ''}`}>{validation.message}</div>
            <div className="organism-panel-foot">
              <span>{fileName}</span>
              <button type="button" className="change-image-btn" onClick={() => fileInputRef.current?.click()}>Change image</button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => loadImage(event.target.files[0])} />
              <button
                type="button"
                className="accept-organism-btn"
                disabled={!validation.valid}
                onClick={acceptImage}
              >
                Accept image
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
