import type { SupabaseClient } from "@supabase/supabase-js";

interface RequestContext {
  db: SupabaseClient;
  userId: string;
}

export async function listProjects(ctx: RequestContext) {
  return ctx.db.from("projects").select("id, name").eq("owner_id", ctx.userId);
}

export class ProjectRepo {
  constructor(private readonly client: SupabaseClient) {}

  archive(id: number) {
    return this.client.from("projects").update({ archived: true }).eq("id", id);
  }
}
