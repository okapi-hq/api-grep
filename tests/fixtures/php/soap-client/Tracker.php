<?php

namespace App\Shipping;

use SoapClient;

class Tracker
{
    private const WSDL = 'https://ws.example-carrier.com/track?wsdl';

    private SoapClient $ratesClient;

    public function __construct()
    {
        $this->ratesClient = new SoapClient('https://ws.example-carrier.com/rates.asmx?WSDL', ['location' => 'https://rates.example-carrier.com/soap']);
    }

    public function track(string $id): object
    {
        $client = new SoapClient(self::WSDL, ['trace' => true]);
        return $client->Track(['Id' => $id]);
    }

    public function cancel(string $id): object
    {
        $client = new \SoapClient(self::WSDL);
        return $client->__soapCall('CancelShipment', [['Id' => $id, 'Reason' => 'customer']]);
    }

    public function rates(string $zip): object
    {
        return $this->ratesClient->GetRates(['Zip' => $zip]);
    }

    public function weather(string $city): object
    {
        $client = new SoapClient(null, ['location' => 'https://ws.example-weather.com/soap', 'uri' => 'urn:weather']);
        return $client->Forecast($city);
    }

    public function label(string $id): object
    {
        $client = new SoapClient(__DIR__ . '/wsdl/labels.wsdl');
        $client->__getFunctions();
        $client->__setSoapHeaders([]);
        return $client->PrintLabel(['Id' => $id]);
    }

    public function void(string $id): object
    {
        $client = new SoapClient(__DIR__ . '/wsdl/labels.wsdl', ['login' => 'api', 'password' => getenv('CARRIER_PASSWORD')]);
        $client->PrintLabels(['Id' => $id]);
        return $client->voidLabel(['Id' => $id]);
    }

    public function any(string $operation, array $args): object
    {
        $client = new SoapClient($this->wsdlUrl());
        return $client->__soapCall($operation, [$args]);
    }

    private function wsdlUrl(): string
    {
        return getenv('CARRIER_WSDL');
    }
}
