export const DEFAULT_SETTINGS = {
  worldSize: 120,
  background: '#0b0e16',
  fog: true,
  showBounds: true,
  boundsColor: '#4c6bb5',
  showAxes: true,
  infiniteGrid: false,
  verticalGrids: true,
  cellSize: 6,
  sectionSize: 30,
  cellColor: '#33406a',
  sectionColor: '#5a7bd8',
  fadeDistance: 300,
  moveSpeed: 30,
  rotateSpeed: 1,
  zoomSpeed: 1,
  damping: 8,
}

export const heightFor = (worldSize) => worldSize / 2

export function loadSettings() {
  try {
    const raw = localStorage.getItem('neurorender.settings.v1')
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}
