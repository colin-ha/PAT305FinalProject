// javascript
const { createApp, ref, onMounted, onUnmounted } = Vue

createApp({
    setup() {
        const active = ref('above')
        // ms
        const fadeDuration = ref(1000)
        // start not playing
        const isPlaying = ref(false)

        // progress / seeking
        const progress = ref(0)          // seconds (current slider value)
        const progressMax = ref(1)       // seconds (duration of active buffer)
        const progressEnabled = ref(false)
        let isScrubbing = false

        let audioCtx = null
        let aboveBuffer = null
        let belowBuffer = null
        let splashBuffer = null
        let aboveSource = null
        let belowSource = null
        let aboveGain = null
        let belowGain = null

        // timeline bookkeeping for accurate progress while playing
        let playbackBaseTime = null // audioCtx.currentTime - timelineOffset
        let rafId = null

        async function loadBuffer(path) {
            try {
                const resp = await fetch(path)
                if (!resp.ok) throw new Error('fetch failed')
                const array = await resp.arrayBuffer()
                return await audioCtx.decodeAudioData(array)
            } catch (e) {
                console.warn('Audio file missing or failed to decode:', path)
                return null
            }
        }

        // create looping nodes but start at provided offset (seconds)
        function createLoopingNodes(buffer, startOffset = 0, initialGain = 1) {
            if (!buffer) return null
            const src = audioCtx.createBufferSource()
            src.buffer = buffer
            src.loop = true
            const g = audioCtx.createGain()
            g.gain.value = initialGain
            src.connect(g).connect(audioCtx.destination)
            // start with given offset (wrap within buffer.duration)
            const off = (startOffset % buffer.duration + buffer.duration) % buffer.duration
            try {
                src.start(0, off)
            } catch (e) {
                // some browsers may throw if start called too early; ignore
                console.warn('src.start failed', e)
            }
            return { src, g }
        }

        function stopAndDisconnect(node) {
            if (!node) return
            try { node.stop(0) } catch (e) {}
            try { node.disconnect() } catch (e) {}
        }

        // restart both looping sources at a given global offset (seconds)
        function restartSourcesAt(offset = 0) {
            if (!audioCtx) return
            // stop old sources
            stopAndDisconnect(aboveSource); stopAndDisconnect(belowSource)
            aboveSource = belowSource = aboveGain = belowGain = null

            if (aboveBuffer) {
                const nodes = createLoopingNodes(aboveBuffer, offset, active.value === 'above' ? 1 : 0)
                if (nodes) { aboveSource = nodes.src; aboveGain = nodes.g }
            }
            if (belowBuffer) {
                const nodes = createLoopingNodes(belowBuffer, offset, active.value === 'below' ? 1 : 0)
                if (nodes) { belowSource = nodes.src; belowGain = nodes.g }
            }

            // set base time so progress is audioCtx.currentTime - offset
            playbackBaseTime = audioCtx.currentTime - offset
        }

        function updateProgressMax() {
            const buf = (active.value === 'above') ? aboveBuffer : belowBuffer
            progressMax.value = buf ? Math.max(0.01, buf.duration) : 1
            progressEnabled.value = !!buf
            if (progress.value > progressMax.value) progress.value = progressMax.value
        }

        onMounted(async () => {
            // defensive clamp: ensure layout doesn't introduce scrolling on some browsers
            try {
                document.documentElement.style.height = '100%';
                document.body.style.height = '100%';
                document.body.style.overflow = 'hidden';
            } catch (e) {}

            audioCtx = new (window.AudioContext || window.webkitAudioContext)()

            // load buffers (non-blocking if files missing)
            aboveBuffer = await loadBuffer('audio/above.wav')
            belowBuffer = await loadBuffer('audio/below.wav')
            splashBuffer = await loadBuffer('audio/splash.wav')

            // set progress bounds based on current active buffer
            updateProgressMax()

            // create sources/gains; start them at current progress (likely 0)
            restartSourcesAt(progress.value || 0)

            // attempt to resume audio context (may be blocked until user gesture)
            audioCtx.resume().then(() => {
                isPlaying.value = true
                // set playbackBaseTime so the RAF shows progress correctly
                playbackBaseTime = audioCtx.currentTime - (progress.value || 0)
            }).catch(() => {
                // autoplay blocked — mark not playing. UI can call togglePlay to resume on user gesture.
                isPlaying.value = false
            })

            // start RAF loop
            function tick() {
                if (!audioCtx) return
                if (!isScrubbing) {
                    const buf = (active.value === 'above') ? aboveBuffer : belowBuffer
                    if (buf && playbackBaseTime != null) {
                        // compute time into the active buffer (modulo buffer.duration)
                        let t = (audioCtx.currentTime - playbackBaseTime) % buf.duration
                        if (t < 0) t += buf.duration
                        progress.value = t
                    }
                }
                rafId = requestAnimationFrame(tick)
            }
            rafId = requestAnimationFrame(tick)
        })

        onUnmounted(() => {
            if (rafId) cancelAnimationFrame(rafId)
            stopAndDisconnect(aboveSource); stopAndDisconnect(belowSource)
            try { if (audioCtx) audioCtx.close() } catch (e) {}
        })

        // helper to play one-shot splash sound
        function playSplash() {
            if (!audioCtx) return
            if (!splashBuffer) return
            // ensure context running (user gesture will usually have resumed it already)
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {})
            }
            const src = audioCtx.createBufferSource()
            src.buffer = splashBuffer
            const g = audioCtx.createGain()
            g.gain.setValueAtTime(1, audioCtx.currentTime)
            src.connect(g).connect(audioCtx.destination)
            src.start()
            src.onended = () => {
                try { src.disconnect(); g.disconnect(); } catch (e) {}
            }
        }

        function crossfade() {
            const next = active.value === 'above' ? 'below' : 'above'

            // set visuals immediately so the water-rise animation and beach fade
            // happen in sync with the audio crossfade.
            active.value = next

            // update slider bounds for the newly active buffer
            updateProgressMax()

            // play the splash sound for tactile feedback on every switch
            playSplash()

            const durSec = Math.max(0.001, Number.isFinite(fadeDuration.value) ? fadeDuration.value / 1000 : 1)
            const now = audioCtx ? audioCtx.currentTime : 0

            // schedule smooth linear ramps for audio (unchanged behavior)
            if (aboveGain) {
                aboveGain.gain.cancelScheduledValues(now)
                const target = next === 'above' ? 1 : 0
                aboveGain.gain.setValueAtTime(aboveGain.gain.value, now)
                aboveGain.gain.linearRampToValueAtTime(target, now + durSec)
            }
            if (belowGain) {
                belowGain.gain.cancelScheduledValues(now)
                const target = next === 'above' ? 0 : 1
                belowGain.gain.setValueAtTime(belowGain.gain.value, now)
                belowGain.gain.linearRampToValueAtTime(target, now + durSec)
            }
        }

        function togglePlay() {
            if (!audioCtx) return
            if (isPlaying.value) {
                // pause
                // capture current timeline offset
                if (playbackBaseTime != null) {
                    const buf = (active.value === 'above') ? aboveBuffer : belowBuffer
                    if (buf) {
                        let t = (audioCtx.currentTime - playbackBaseTime) % buf.duration
                        if (t < 0) t += buf.duration
                        progress.value = t
                    }
                }
                audioCtx.suspend().then(() => { isPlaying.value = false }).catch(() => {})
            } else {
                // resume: set base time relative to current progress so play continues from slider value
                playbackBaseTime = audioCtx.currentTime - (progress.value || 0)
                // restart sources to ensure they begin at the desired offset
                restartSourcesAt(progress.value || 0)
                audioCtx.resume().then(() => { isPlaying.value = true }).catch(() => {})
            }
        }

        // UI handlers for scrubbing
        function onScrub() {
            // while sliding, mark scrubbing and immediately restart sources to the chosen time
            isScrubbing = true
            // restart sources at the chosen progress value
            restartSourcesAt(progress.value || 0)
        }
        function onScrubEnd() {
            isScrubbing = false
            // update playback base time so RAF and resumed play are consistent
            playbackBaseTime = audioCtx ? (audioCtx.currentTime - (progress.value || 0)) : null
            // if audio is suspended, keep it suspended (we still created sources)
            // if audio is playing, ensure context is resumed (user likely performed gesture)
            if (audioCtx && audioCtx.state === 'suspended' && isPlaying.value) {
                audioCtx.resume().catch(()=>{})
            }
        }

        function formatTime(s) {
            if (!isFinite(s) || s < 0) return '0:00'
            const m = Math.floor(s / 60)
            const sec = Math.floor(s % 60).toString().padStart(2, '0')
            return `${m}:${sec}`
        }

        return {
            active, crossfade, fadeDuration, isPlaying, togglePlay,
            progress, progressMax, progressEnabled, onScrub, onScrubEnd, formatTime
        }
    }
}).mount('#app')
