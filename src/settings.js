// Scene/camera defaults, persisted to localStorage.

export const DEFAULT_SETTINGS = {
  worldSize: 120,
  showAxes: true,
  infiniteGrid: false,
  verticalGrids: true,
  cellSize: 6,
  sectionSize: 30,
  moveSpeed: 30,
  rotateSpeed: 1,
  zoomSpeed: 1,
  damping: 8,
}

// World height is always half its width.
export const heightFor = (worldSize) => worldSize / 2

// Loads saved settings, falling back to defaults if storage is empty or broken.
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
