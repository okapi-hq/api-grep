// Reading local data through fetch: no request leaves the browser.
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export async function pixelBlob() {
  const res = await fetch(PIXEL);
  return res.blob();
}

export async function canvasBlob(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL("image/png");
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function reread(file: Blob) {
  const objectUrl = URL.createObjectURL(file);
  return fetch(objectUrl).then((r) => r.arrayBuffer());
}
