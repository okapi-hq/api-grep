<?php

namespace App\Shipping;

use GuzzleHttp\Client;

class Carrier
{
    private const SERVICE = 'https://ws.example-carrier.com/track/v2';

    public function rates(string $zip): string
    {
        $xml = <<<XML
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetRates><Zip>{$zip}</Zip></GetRates>
  </soap:Body>
</soap:Envelope>
XML;
        $client = new Client();
        $res = $client->post(self::SERVICE, [
            'headers' => ['Content-Type' => 'text/xml', 'SOAPAction' => '"http://example-carrier.com/Rates"'],
            'body' => $xml,
        ]);
        return (string) $res->getBody();
    }

    public function label(string $id): string
    {
        $ch = curl_init(self::SERVICE);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: text/xml']);
        curl_setopt($ch, CURLOPT_POSTFIELDS, '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><PrintLabel><Id>' . $id . '</Id></PrintLabel></soap:Body></soap:Envelope>');
        return curl_exec($ch);
    }

    public function order(string $id): void
    {
        $doc = new \SimpleXMLElement('<Order/>');
        $doc->addChild('Id', $id);
        (new Client())->post('https://orders.example-shop.com/api/orders', ['body' => $doc->asXML()]);
    }

    public function topics(): void
    {
        (new Client())->get('https://sns.us-east-1.amazonaws.com/?Action=ListTopics&Version=2010-03-31');
    }
}
