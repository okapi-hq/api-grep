<?php

namespace App\Clients;

use GuzzleHttp\Client;

class Gladia
{
    private string $baseUrl;

    public function __construct(private Client $http, ?string $baseUrl = null)
    {
        $this->baseUrl = $baseUrl ?? 'https://api.gladia.io';
    }

    public function upload(string $audioUrl)
    {
        return $this->http->post("{$this->baseUrl}/v2/upload", ['json' => ['audio_url' => $audioUrl]]);
    }
}

class ElevenLabs
{
    public function __construct(private Client $http, private string $baseUrl = 'https://api.elevenlabs.io/v1')
    {
    }

    public function voices()
    {
        return $this->http->get($this->baseUrl . '/voices');
    }
}
