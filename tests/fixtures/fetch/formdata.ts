const KEY = process.env.OPENAI_KEY;

export function upload(blob: Blob) {
  const fd = new FormData();
  fd.append("file", blob);
  fd.append("purpose", "fine-tune");
  return fetch("https://api.openai.com/v1/files", { method: "POST", body: fd, headers: { "x-api-key": KEY } });
}
