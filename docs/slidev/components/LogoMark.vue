<template>
  <!-- Real Kiba logomark (triangle of nodes + dotted particle field),
       cropped from the brand asset and given the site's electric-blue glow. -->
  <img
    src="/logomark-mark.png"
    alt="Kiba"
    class="kiba-mark"
    :style="{
      width: typeof size === 'number' ? size + 'px' : size,
      height: typeof size === 'number' ? size + 'px' : size,
    }"
  />
</template>

<script setup>
defineProps({
  size: { type: [Number, String], default: 120 },
})
</script>

<style scoped>
.kiba-mark {
  object-fit: contain;
  filter: drop-shadow(0 0 38px var(--logo-glow));
}
</style>
