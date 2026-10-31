import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import {
  BLINK_EAR_THRESHOLD,
  TURN_OFFSET_THRESHOLD,
  blinkRatio,
  detectFace,
  loadFaceModels,
  noseOffsetX,
} from './faceEngine.js'

const TICK_MS = 220

/**
 * Reusable camera + liveness component. Runs a detection loop until the requested liveness action
 * is satisfied, then captures one 128-D descriptor and calls `onCapture`. `challenge` is one of
 * 'blink' | 'turn-left' | 'turn-right', or null for enrollment (a blink is still required so a
 * static photo cannot be enrolled).
 */
export default function FaceScanner({ challenge, onCapture, onError }) {
  const { t } = useI18n()
  const videoRef = useRef(null)
  const [phase, setPhase] = useState('loading') // loading | ready | done | error
  const [hint, setHint] = useState('')
  const streamRef = useRef(null)
  const capturedRef = useRef(false)
  const blinkClosedRef = useRef(false)
  const onCaptureRef = useRef(onCapture)
  const onErrorRef = useRef(onError)
  onCaptureRef.current = onCapture
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    let interval = null

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    const finish = (descriptor) => {
      if (capturedRef.current) return
      capturedRef.current = true
      setPhase('done')
      stopStream()
      onCaptureRef.current(descriptor)
    }

    async function start() {
      try {
        await loadFaceModels()
        if (cancelled) return
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        setPhase('ready')
        setHint(challenge === 'turn-left' ? 'faceTurnLeftHint' : challenge === 'turn-right' ? 'faceTurnRightHint' : 'faceBlinkHint')

        interval = setInterval(async () => {
          if (capturedRef.current) return
          let detection = null
          try {
            detection = await detectFace(video)
          } catch {
            // A transient detection failure just skips this tick.
          }
          if (!detection) {
            setHint('faceNoFaceHint')
            return
          }
          const ear = blinkRatio(detection.landmarks)
          const offset = noseOffsetX(detection.landmarks)

          if (challenge === 'turn-left') {
            setHint('faceTurnLeftHint')
            if (offset < -TURN_OFFSET_THRESHOLD) finish(detection.descriptor)
          } else if (challenge === 'turn-right') {
            setHint('faceTurnRightHint')
            if (offset > TURN_OFFSET_THRESHOLD) finish(detection.descriptor)
          } else {
            // 'blink' or enroll: require a blink (eyes close then reopen).
            setHint('faceBlinkHint')
            if (ear < BLINK_EAR_THRESHOLD) blinkClosedRef.current = true
            else if (blinkClosedRef.current) finish(detection.descriptor)
          }
        }, TICK_MS)
      } catch (error) {
        if (cancelled) return
        setPhase('error')
        onErrorRef.current(error?.name === 'NotAllowedError' || error?.name === 'NotFoundError' ? 'faceCameraDenied' : 'faceModelError')
      }
    }

    start()
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
      stopStream()
    }
  }, [challenge])

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 420, margin: '0 auto' }}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: '100%',
          aspectRatio: '4 / 3',
          objectFit: 'cover',
          borderRadius: 14,
          background: '#0f172a',
          transform: 'scaleX(-1)',
        }}
      />
      {phase === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          {t('faceLoading')}
        </div>
      )}
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', marginTop: 12, fontSize: '.9rem', color: 'var(--v2-ink-muted)' }}>
          {t(hint)}
        </div>
      )}
      {phase === 'done' && (
        <div className="v2-notice" style={{ marginTop: 12 }}>{t('faceCaptured')}</div>
      )}
      {phase === 'error' && (
        <div className="v2-notice v2-notice-error" style={{ marginTop: 12 }}>{t('faceCameraDenied')}</div>
      )}
    </div>
  )
}
