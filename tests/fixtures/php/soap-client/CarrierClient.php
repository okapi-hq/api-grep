<?php

namespace App\Shipping;

class CarrierClient extends \SoapClient
{
    public function __construct()
    {
        parent::__construct('https://ws.example-carrier.com/status?wsdl', ['exceptions' => true]);
    }

    public function status(string $id): object
    {
        return $this->TrackStatus(['Id' => $id]);
    }
}

function quote(\SoapClient $client, string $zip): object
{
    return $client->GetRates(['Zip' => $zip]);
}

function outside(string $id): object
{
    return (new CarrierClient())->TrackStatus(['Id' => $id]);
}
