<?php

namespace App\Http;

use GuzzleHttp\Client;
use GuzzleHttp\Psr7\Request;
use Psr\Http\Client\ClientInterface;

class Webhooks
{
    public function __construct(private ClientInterface $client)
    {
    }

    private function jsonRequest(string $method, string $uri, array $data): Request
    {
        return new Request($method, $uri, ['Content-Type' => 'application/json'], json_encode($data));
    }

    public function dispatch(string $endpoint, array $payload)
    {
        return $this->client->sendRequest($this->jsonRequest('POST', $endpoint, $payload));
    }

    public function ping()
    {
        $guzzle = new Client();
        return $guzzle->send(new Request('GET', 'https://status.example.com/api/v2/status.json'));
    }
}
