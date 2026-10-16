<template>
  <ul>
    <li v-for="m in messages" :key="m.id" @click="open(m.id)">{{ m.subject }}</li>
  </ul>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

const API = "https://api.mailroom.dev/v1";
const messages = ref<{ id: string; subject: string }[]>([]);

onMounted(async () => {
  const res = await fetch(`${API}/inbox?unread=true`, {
    headers: { Authorization: `Bearer ${import.meta.env.VITE_MAILROOM_TOKEN}` },
  });
  messages.value = await res.json();
});

async function open(id: string) {
  await fetch(`${API}/messages/${id}/read`, { method: "POST" });
}
</script>

<style scoped>
li { cursor: pointer; }
</style>
