<?php

require 'vendor/autoload.php';

MercadoPago\SDK::setAccessToken(getenv('MP_ACCESS_TOKEN'));

function legacyPreference(string $title)
{
    $item = new MercadoPago\Item();
    $item->title = $title;
    $item->quantity = 1;
    $preference = new MercadoPago\Preference();
    $preference->items = [$item];
    $preference->external_reference = 'tp-legacy';
    $preference->save();
    return $preference->init_point;
}

function legacyPayment(int $id)
{
    $payment = MercadoPago\Payment::find_by_id($id);
    $payment->status = 'cancelled';
    $payment->update();
    return MercadoPago\Payment::search(['status' => 'approved']);
}
