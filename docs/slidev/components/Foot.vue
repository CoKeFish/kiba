<template>
  <div class="slide-footer">
    <span>kiba · on Stellar</span>
    <span>{{ String(n).padStart(2, '0') }}</span>
  </div>
</template>

<script setup>
defineProps({ n: { type: [Number, String], default: '' } })
</script>
