<?php

namespace App\Service;

use Symfony\Component\HttpClient\HttpClient;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class Weather
{
    public function __construct(private HttpClientInterface $client, private string $apiKey)
    {
    }

    public function forecast(float $lat, float $lon): array
    {
        return $this->client->request('GET', 'https://api.open-meteo.com/v1/forecast', ['query' => ['latitude' => $lat, 'longitude' => $lon]])->toArray();
    }

    public function track(string $event): void
    {
        $this->client->request('POST', 'https://api.segment.io/v1/track', ['json' => ['event' => $event], 'auth_basic' => [$this->apiKey, '']]);
    }
}

function vercel(string $token)
{
    $client = HttpClient::createForBaseUri('https://api.vercel.com', ['auth_bearer' => $token]);
    return $client->request('GET', '/v9/projects');
}

function linear(string $query)
{
    $client = HttpClient::create(['base_uri' => 'https://api.linear.app']);
    return $client->request('POST', '/graphql', ['json' => ['query' => $query], 'auth_bearer' => 'key']);
}
