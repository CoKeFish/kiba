<template>
  <!-- Brand background: scheme-aware canvas + radial glow + drifting particles.
       Colors come from CSS vars (--kiba-bg / --kiba-particle / --kiba-glow-*),
       so it flips automatically between the light and dark themes. -->
  <div class="ab-bg">
    <div class="ab-glow" />
    <canvas ref="cv" class="ab-particles" />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const cv = ref(null)
let raf, ro

onMounted(() => {
  const c = cv.value
  if (!c) return
  const ctx = c.getContext('2d')
  let w, h, dots
  const density = 70

  function resize() {
    const dpr = window.devicePixelRatio || 1
    c.width = c.offsetWidth * dpr
    c.height = c.offsetHeight * dpr
    w = c.width; h = c.height
    dots = Array.from({ length: density }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      a: Math.random() * 0.6 + 0.2,
    }))
  }
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(c)

  function tick() {
    // Read theme-driven particle color once per frame.
    const cs = getComputedStyle(document.documentElement)
    const rgb = (cs.getPropertyValue('--kiba-particle') || '79,134,255').replace(/"/g, '').trim()
    const op = parseFloat(cs.getPropertyValue('--kiba-particle-opacity') || '0.5')

    ctx.clearRect(0, 0, w, h)
    ctx.shadowColor = `rgb(${rgb})`
    ctx.shadowBlur = 8
    for (const d of dots) {
      d.x += d.vx; d.y += d.vy
      if (d.x < 0 || d.x > w) d.vx *= -1
      if (d.y < 0 || d.y > h) d.vy *= -1
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb}, ${d.a * op})`
      ctx.fill()
    }
    raf = requestAnimationFrame(tick)
  }
  tick()
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  if (ro) ro.disconnect()
})
</script>

<style scoped>
.ab-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: var(--kiba-bg);
  pointer-events: none;
}
.ab-glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 16% 38%, var(--kiba-glow-1), transparent 60%),
    radial-gradient(ellipse 50% 45% at 88% 88%, var(--kiba-glow-2), transparent 60%);
}
.ab-particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  mix-blend-mode: var(--kiba-blend);
}
</style>
