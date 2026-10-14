<?php

namespace App\Legacy;

use Vendor\Transport\SoapClient;

// a class named SoapClient from another namespace is not ext-soap's
class Legacy
{
    public function send(string $id): void
    {
        $client = new SoapClient('https://ws.example-legacy.com/api?wsdl');
        $client->Track(['Id' => $id]);
    }
}
