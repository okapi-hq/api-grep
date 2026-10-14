import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "./shopify.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const redirect = await admin.rest.resources.Redirect.find({ session, id: Number(params.id) });
  redirect.target = "/kites/summer";
  await redirect.save({ update: true });
  return redirect;
}
