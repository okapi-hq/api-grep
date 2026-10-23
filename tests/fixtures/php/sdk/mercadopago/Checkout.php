<?php

namespace Tidepool\Billing;

use MercadoPago\Client\Common\RequestOptions;
use MercadoPago\Client\Customer\CustomerClient;
use MercadoPago\Client\Order\OrderClient;
use MercadoPago\Client\Payment\PaymentClient;
use MercadoPago\Client\Payment\PaymentRefundClient;
use MercadoPago\Client\Preference\PreferenceClient;
use MercadoPago\MercadoPagoConfig;
use MercadoPago\Net\MPSearchRequest;

class Checkout
{
    public function __construct()
    {
        MercadoPagoConfig::setAccessToken(getenv('MP_ACCESS_TOKEN'));
    }

    public function preference(string $title, float $price): string
    {
        $client = new PreferenceClient();
        $preference = $client->create([
            'items' => [['title' => $title, 'quantity' => 1, 'unit_price' => $price]],
            'back_urls' => ['success' => 'https://tidepool.example/ok'],
            'external_reference' => 'tp-order',
        ]);
        return $preference->init_point;
    }

    public function pay(string $token, float $amount, string $email)
    {
        $options = new RequestOptions();
        $options->setCustomHeaders(['X-Idempotency-Key: tp-1']);
        $payments = new PaymentClient();
        return $payments->create([
            'transaction_amount' => $amount,
            'token' => $token,
            'installments' => 1,
            'payer' => ['email' => $email],
        ], $options);
    }

    public function status(int $paymentId)
    {
        return (new PaymentClient())->get($paymentId);
    }

    public function cancel(int $paymentId)
    {
        $payments = new PaymentClient();
        $payments->cancel($paymentId);
        return $payments->search(new MPSearchRequest(20, 0, ['status' => 'approved']));
    }

    public function refund(int $paymentId, float $amount)
    {
        $refunds = new PaymentRefundClient();
        return $refunds->refund($paymentId, $amount);
    }

    public function shopper(string $email)
    {
        $customers = new CustomerClient();
        $customers->update('cus-1', ['phone' => ['number' => '555']]);
        return $customers->createByEmail($email);
    }

    public function order(string $id)
    {
        $orders = new \MercadoPago\Client\Order\OrderClient();
        return $orders->capture($id);
    }
}
