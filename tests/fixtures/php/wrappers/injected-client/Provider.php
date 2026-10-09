<?php

class Provider
{
    private $client;
    private $fetchFn;

    public function __construct($client, $fetchFn = null)
    {
        $this->client = $client;
        $this->fetchFn = $fetchFn;
    }

    public function run(string $prompt)
    {
        return $this->client->post('https://api.mistral.ai/v1/chat/completions', ['json' => ['prompt' => $prompt]]);
    }

    public function upstream($deps, string $url)
    {
        return $deps->fetchUpstream($url);
    }

    public function lookup($cache, string $url)
    {
        return $cache->get($url);
    }
}
