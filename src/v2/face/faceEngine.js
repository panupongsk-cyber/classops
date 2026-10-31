import * as tf from '@tensorflow/tfjs'
import * as faceapi from 'face-api.js'

// Face check-in engine: lazy-loads the self-hosted face-api.js models (from /models, served by
// nginx as static assets) and exposes the pieces the enroll and check-in views need. The browser
// computes 128-D descriptors here; only the vectors leave the device -- never an image.

let modelsPromise = null

export function loadFaceModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      await tf.ready()
      try {
        await tf.setBackend('webgl')
      } catch {
        // No WebGL (or it failed): fall back to CPU. Slower, but still correct.
        await tf.setBackend('cpu')
      }
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ])
    })()
  }
  return modelsPromise
}

/**
 * Detect a single face in `video` and return its landmarks + 128-D descriptor, or null when no
 * face is found in this frame. `descriptor` is returned as a plain number[] (serializable).
 */
export async function detectFace(video) {
  await loadFaceModels()
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
  if (!result) return null
  return {
    landmarks: result.landmarks,
    descriptor: Array.from(result.descriptor),
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function eyeAspectRatio(points, indices) {
  const vertical = distance(points[indices[1]], points[indices[5]]) + distance(points[indices[2]], points[indices[4]])
  const horizontal = 2 * distance(points[indices[0]], points[indices[3]])
  return horizontal === 0 ? 1 : vertical / horizontal
}

/** Average eye-aspect ratio (EAR). Drops toward ~0 when the eyes close (blink). */
export function blinkRatio(landmarks) {
  const points = landmarks.positions
  const left = eyeAspectRatio(points, [36, 37, 38, 39, 40, 41])
  const right = eyeAspectRatio(points, [42, 43, 44, 45, 46, 47])
  return (left + right) / 2
}

/**
 * Normalized horizontal offset of the nose tip from the face's center, in [-0.5, 0.5]. Negative
 * means the nose is to the image-left (head turned left), positive means image-right.
 */
export function noseOffsetX(landmarks) {
  const points = landmarks.positions
  let minX = Infinity
  let maxX = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
  }
  const width = maxX - minX || 1
  return (points[30].x - (minX + maxX) / 2) / width
}

// Liveness thresholds, kept coarse on purpose: the goal is to reject a static photo or a screen
// replay, not to be a high-assurance anti-spoofing system (see face-checkin-product-spec.md).
export const BLINK_EAR_THRESHOLD = 0.25
export const TURN_OFFSET_THRESHOLD = 0.12
