import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { heightFor } from '../settings.js'

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

function panLimit(st, settings) {
  const zoomAllowance = Math.min(4, settings.worldSize / Math.max(2, st.dDist))
  return settings.worldSize * (0.65 + zoomAllowance)
}

function isTypingTarget(target) {
  if (!target || !target.tagName) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable === true
  )
}

function resetState(st, settings) {
  const target = new THREE.Vector3(0, 0, 0)
  st.dYaw = 0.65
  st.dPitch = 0.42
  st.dDist = Math.max(30, settings.worldSize * 0.95)
  st.dTarget.copy(target)
  st.dOrientation
    .setFromEuler(new THREE.Euler(-st.dPitch, st.dYaw, 0, 'YXZ'))
}

function createState(settings) {
  const st = {
    yaw: 0,
    pitch: 0,
    dist: 0,
    target: new THREE.Vector3(),
    dYaw: 0,
    dPitch: 0,
    dDist: 0,
    dTarget: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    dOrientation: new THREE.Quaternion(),
    reportAcc: 1,
  }
  resetState(st, settings)
  st.orientation.copy(st.dOrientation)
  st.dist = st.dDist
  st.target.copy(st.dTarget)
  return st
}

export default function CameraRig({ settings, resetKey, onCamera }) {
  const { camera, gl } = useThree()
  const stateRef = useRef(null)
  const keysRef = useRef(new Set())
  const settingsRef = useRef(settings)
  const onCameraRef = useRef(onCamera)
  const tmp = useMemo(
    () => ({
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
      offset: new THREE.Vector3(0, 0, 1),
    }),
    [],
  )

  const getState = () => {
    if (!stateRef.current) stateRef.current = createState(settingsRef.current)
    return stateRef.current
  }

  useEffect(() => {
    settingsRef.current = settings
    onCameraRef.current = onCamera
  })

  useEffect(() => {
    resetState(getState(), settingsRef.current)
  }, [resetKey])

  useEffect(() => {
    const dom = gl.domElement
    const drag = { mode: null, lastX: 0, lastY: 0, pointerId: -1 }

    const clampTarget = (st) => {
      const cfg = settingsRef.current
      const box = panLimit(st, cfg)
      const up = heightFor(cfg.worldSize) * 1.25
      st.dTarget.x = clamp(st.dTarget.x, -box, box)
      st.dTarget.z = clamp(st.dTarget.z, -box, box)
      st.dTarget.y = clamp(st.dTarget.y, -up * 0.2, up)
    }

    const onPointerDown = (e) => {
      if (e.button === 0) drag.mode = 'rotate'
      else if (e.button === 2) drag.mode = 'pan'
      else return
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.pointerId = e.pointerId
      dom.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e) => {
      if (!drag.mode || e.pointerId !== drag.pointerId) return
      const st = getState()
      const cfg = settingsRef.current
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY

      if (drag.mode === 'rotate') {
        const s = cfg.rotateSpeed * 0.0045
        tmp.right.set(1, 0, 0).applyQuaternion(st.dOrientation)
        tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
        tmp.rotation.setFromAxisAngle(tmp.up, -dx * s)
        st.dOrientation.premultiply(tmp.rotation)
        tmp.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
        tmp.rotation.setFromAxisAngle(tmp.right, -dy * s)
        st.dOrientation.premultiply(tmp.rotation)
      } else {
        const pan = cfg.rotateSpeed * st.dist * 0.0016
        tmp.right.setFromMatrixColumn(camera.matrix, 0)
        tmp.up.setFromMatrixColumn(camera.matrix, 1)
        st.dTarget.addScaledVector(tmp.right, -dx * pan)
        st.dTarget.addScaledVector(tmp.up, dy * pan)
        clampTarget(st)
      }
    }

    const onPointerUp = (e) => {
      if (e.pointerId !== drag.pointerId) return
      drag.mode = null
      drag.pointerId = -1
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId)
    }

    const onWheel = (e) => {
      e.preventDefault()
      const st = getState()
      const cfg = settingsRef.current
      st.dDist = clamp(
        st.dDist * Math.exp(e.deltaY * 0.0012 * cfg.zoomSpeed),
        2,
        cfg.worldSize * 6,
      )
    }

    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return
      if (MOVE_KEYS.has(e.code)) e.preventDefault()
      keysRef.current.add(e.code)
    }

    const onKeyUp = (e) => {
      keysRef.current.delete(e.code)
    }

    const onBlur = () => keysRef.current.clear()
    const onContextMenu = (e) => e.preventDefault()

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    dom.addEventListener('wheel', onWheel, { passive: false })
    dom.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      dom.removeEventListener('wheel', onWheel)
      dom.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [gl, camera, tmp])

  useFrame((_, delta) => {
    const st = getState()
    const cfg = settingsRef.current
    const dt = Math.min(delta, 0.05)
    const keys = keysRef.current

    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1
    const speed = cfg.moveSpeed * (0.4 + st.dDist * 0.05) * sprint
    tmp.forward.set(0, 0, -1).applyQuaternion(st.dOrientation)
    tmp.right.set(1, 0, 0).applyQuaternion(st.dOrientation)

    let mx = 0
    let mz = 0
    if (keys.has('KeyW')) {
      mx += tmp.forward.x
      mz += tmp.forward.z
    }
    if (keys.has('KeyS')) {
      mx -= tmp.forward.x
      mz -= tmp.forward.z
    }
    if (keys.has('KeyD')) {
      mx += tmp.right.x
      mz += tmp.right.z
    }
    if (keys.has('KeyA')) {
      mx -= tmp.right.x
      mz -= tmp.right.z
    }
    if (keys.has('KeyQ') || keys.has('KeyE')) {
      const roll = (keys.has('KeyQ') ? -1 : 1) * cfg.rotateSpeed * dt
      tmp.forward.set(0, 0, -1).applyQuaternion(st.dOrientation)
      tmp.rotation.setFromAxisAngle(tmp.forward, roll)
      st.dOrientation.premultiply(tmp.rotation)
    }

    const mag = Math.hypot(mx, mz)
    if (mag > 0) {
      const inv = mag > 0 ? 1 / mag : 0
      st.dTarget.x += mx * inv * speed * dt
      st.dTarget.z += mz * inv * speed * dt
      const box = panLimit(st, cfg)
      const up = heightFor(cfg.worldSize) * 1.25
      st.dTarget.x = clamp(st.dTarget.x, -box, box)
      st.dTarget.z = clamp(st.dTarget.z, -box, box)
      st.dTarget.y = clamp(st.dTarget.y, -up * 0.2, up)
    }

    const k = 1 - Math.exp(-dt * cfg.damping)
    st.orientation.slerp(st.dOrientation, k)
    st.dist += (st.dDist - st.dist) * k
    st.target.lerp(st.dTarget, k)

    tmp.offset.set(0, 0, st.dist).applyQuaternion(st.orientation)
    camera.position.copy(st.target).add(tmp.offset)
    camera.quaternion.copy(st.orientation)

    st.reportAcc += dt
    if (st.reportAcc > 0.05 && onCameraRef.current) {
      st.reportAcc = 0
      onCameraRef.current({
        position: camera.position.toArray(),
        target: st.target.toArray(),
        dist: st.dist,
      })
    }
  })

  return null
}
