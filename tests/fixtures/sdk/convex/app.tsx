import { ConvexHttpClient } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { api } from "./_generated/api";

const http = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function TaskList() {
  const tasks = useQuery(api.tasks.list, { done: false });
  const add = useMutation(api.tasks.create);
  return { tasks, add };
}

export const report = (teamId: string) => http.query(api.reports.weekly.summary, { teamId });
