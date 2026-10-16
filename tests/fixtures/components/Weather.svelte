<script context="module" lang="ts">
  export const BASE = "https://api.skyward.dev/v3";
</script>

<script lang="ts">
  export let city: string;

  async function forecast() {
    const r = await fetch(`${BASE}/forecast?city=${encodeURIComponent(city)}`);
    return r.json();
  }
</script>

<!-- <script>fetch("https://api.skyward.dev/v3/commented-out")</script> -->
{#await forecast() then data}
  <p>{data.summary}</p>
{/await}
<button on:click={() => fetch("https://api.skyward.dev/v3/refresh")}>Refresh</button>
