import { CartForm } from "@shopify/hydrogen";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request, context }: ActionFunctionArgs) {
  const { cart } = context;
  const { action, inputs } = CartForm.getFormInput(await request.formData());
  switch (action) {
    case CartForm.ACTIONS.DeliveryAddressesAdd:
      return cart.addDeliveryAddresses(inputs.addresses);
    case CartForm.ACTIONS.DeliveryAddressesUpdate:
      return cart.updateDeliveryAddresses(inputs.addresses);
    case CartForm.ACTIONS.DeliveryAddressesRemove:
      return cart.removeDeliveryAddresses(inputs.addressIds);
    case CartForm.ACTIONS.DeliveryAddressesReplace:
      return cart.replaceDeliveryAddresses(inputs.addresses);
    case CartForm.ACTIONS.GiftCardCodesAdd:
      return cart.addGiftCardCodes([inputs.giftCardCode]);
    default:
      return cart.removeGiftCardCodes(inputs.appliedGiftCardIds);
  }
}
