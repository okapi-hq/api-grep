import { put, del, list } from "@vercel/blob";
import { upload } from "@vercel/blob/client";

export async function saveAvatar(userId: string, file: Blob) {
  const blob = await put(`avatars/${userId}.png`, file, { access: "public" });
  return blob.url;
}

export const removeAvatar = (url: string) => del(url);

export const allAvatars = () => list({ prefix: "avatars/" });

export const fromBrowser = (file: File) => upload(file.name, file, { access: "public", handleUploadUrl: "/api/avatar/upload" });

// a Map's put-like methods are not the SDK
const store = new Map<string, Blob>();
export const keep = (k: string, b: Blob) => store.set(k, b);
