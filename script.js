// javascript
const { createApp, ref, onMounted } = Vue

createApp({
    setup() {
        const active = ref('above')
        // ms
        const fadeDuration = ref(1000)
        // start not playing
        const isPlaying = ref(false)

        let audioCtx = null
        let aboveBuffer = null
        let belowBuffer = null
        let aboveSource = null
        let belowSource = null
        let aboveGain = null
        let belowGain = null

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

        function createLoopingNodes(buffer, initialGain = 1) {
            if (!buffer) return null
            const src = audioCtx.createBufferSource()
            src.buffer = buffer
            src.loop = true
            const g = audioCtx.createGain()
            g.gain.value = initialGain
            src.connect(g).connect(audioCtx.destination)
            src.start(0)
            return { src, g }
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

            // create sources/gains; start them immediately as looping sources
            const aboveNodes = createLoopingNodes(aboveBuffer, 1)
            const belowNodes = createLoopingNodes(belowBuffer, 0)

            if (aboveNodes) {
                aboveSource = aboveNodes.src
                aboveGain = aboveNodes.g
            }
            if (belowNodes) {
                belowSource = belowNodes.src
                belowGain = belowNodes.g
            }

            // attempt to resume audio context (may be blocked until user gesture)
            audioCtx.resume().then(() => {
                isPlaying.value = true
            }).catch(() => {
                // autoplay blocked — mark not playing. UI can call togglePlay to resume on user gesture.
                isPlaying.value = false
            })
        })

        function crossfade() {
            const next = active.value === 'above' ? 'below' : 'above'

            // set visuals immediately so the water-rise animation and beach fade
            // happen in sync with the audio crossfade.
            active.value = next

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
                audioCtx.suspend().then(() => { isPlaying.value = false }).catch(() => {})
            } else {
                // resume (must be called from user gesture to succeed if previously blocked)
                audioCtx.resume().then(() => { isPlaying.value = true }).catch(() => {})
            }
        }

        return { active, crossfade, fadeDuration, isPlaying, togglePlay }
    }
}).mount('#app')
