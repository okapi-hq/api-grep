<?php

namespace App\Billing;

use Stripe\Checkout\Session;
use Stripe\Customer;
use Stripe\PaymentIntent;
use Stripe\StripeClient;

class Billing
{
    public function __construct(private StripeClient $stripe)
    {
    }

    public function customer(string $email)
    {
        return $this->stripe->customers->create(['email' => $email, 'name' => 'Ada']);
    }

    public function sessions(string $customer)
    {
        return $this->stripe->checkout->sessions->all(['customer' => $customer, 'limit' => 3]);
    }

    public function legacy(string $email)
    {
        return Customer::create(['email' => $email]);
    }

    public function checkout(string $price)
    {
        return Session::create(['mode' => 'payment', 'line_items' => [['price' => $price, 'quantity' => 1]]]);
    }

    public function confirm(string $id)
    {
        return PaymentIntent::retrieve($id)->confirm(['payment_method' => 'pm_card_visa']);
    }
}
