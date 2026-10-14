import { CartForm } from "@shopify/hydrogen";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@shopify/remix-oxygen";

export async function action({ request, context }: ActionFunctionArgs) {
  const { cart } = context;
  const { action, inputs } = CartForm.getFormInput(await request.formData());
  switch (action) {
    case CartForm.ACTIONS.LinesAdd:
      return cart.addLines(inputs.lines);
    case CartForm.ACTIONS.LinesUpdate:
      return cart.updateLines(inputs.lines);
    case CartForm.ACTIONS.LinesRemove:
      return cart.removeLines(inputs.lineIds);
    default:
      return cart.updateNote(`gift wrap: ${inputs.note}`);
  }
}

export async function loader({ context }: LoaderFunctionArgs) {
  return { cart: await context.cart.get() };
}

export async function applyCode({ context: { cart } }: ActionFunctionArgs, code: string) {
  return cart.updateDiscountCodes([code]);
}

/** Not Hydrogen's cart: a map the code fills itself. */
export function cachedTeas(teas: string[]) {
  const cart = new Map<string, number>();
  for (const tea of teas) cart.set(tea, (cart.get(tea) ?? 0) + 1);
  return cart;
}
