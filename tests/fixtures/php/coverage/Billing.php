<?php

use Stripe\StripeClient;

function charge(StripeClient $stripe, string $customer)
{
    return $stripe->paymentIntents->create(['customer' => $customer, 'amount' => 1000, 'currency' => 'eur']);
}
