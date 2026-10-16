<template><button @click="save">Save</button></template>

<script>
import axios from "axios";

export default {
  methods: {
    save() {
      return axios.put("https://api.mailroom.dev/v1/settings", { digest: "weekly" });
    },
  },
};
</script>
