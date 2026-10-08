import { supabase } from "./client";

export async function getTask(id: string) {
  const { data } = await supabase.from("tasks").select("id, title, done").eq("id", id).single();
  return data;
}

export async function addTask(title: string, projectId: number) {
  return supabase.from("tasks").insert({ title, project_id: projectId, done: false }).select();
}

export const saveTask = (task: { id: string; title: string }) => supabase.from("tasks").upsert(task);

export const closeTask = (id: string) => supabase.from("tasks").update({ done: true }).eq("id", id);

export const dropTask = (id: string) => supabase.from("tasks").delete().eq("id", id);

export async function dashboard() {
  const [tasks, projects] = await Promise.all([supabase.from("tasks").select("*"), supabase.from("projects").select("id, name")]);
  return { tasks, projects };
}

export const stats = (projectId: number) => (supabase as any).rpc("project_stats", { project_id: projectId });

export async function me() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export const login = (email: string, password: string) => supabase.auth.signInWithPassword({ email, password });

export async function uploadAvatar(userId: string, file: Blob) {
  return supabase.storage.from("avatars").upload(`${userId}/avatar.png`, file);
}

export const notify = (taskId: string) => supabase.functions.invoke("notify-assignee", { body: { taskId } });
