import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "./shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  return admin.rest.resources.Product.all({ session, limit: 20 });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const redirect = new admin.rest.resources.Redirect({ session });
  redirect.path = "/old-kites";
  redirect.target = "/kites";
  await redirect.save({ update: true });
  return redirect;
}
