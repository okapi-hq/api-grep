<?php

namespace App\Ai;

use GuzzleHttp\Client;

class Assistant
{
    private Client $http;

    public function summarize(string $text, string $model = 'gpt-4o-mini', int $maxTokens = 1024)
    {
        return $this->http->post('https://api.openai.com/v1/chat/completions', ['json' => ['model' => $model, 'max_tokens' => $maxTokens, 'messages' => [['role' => 'user', 'content' => $text]]]]);
    }

    public function translate(string $text, string $model = 'gpt-4o-mini', int $maxTokens = 1024)
    {
        return $this->http->post('https://api.openai.com/v1/chat/completions', ['json' => ['model' => $model, 'max_tokens' => $maxTokens, 'messages' => [['role' => 'user', 'content' => $text]]]]);
    }

    public function classify(string $text, string $model = 'gpt-4o-mini', int $maxTokens = 1024)
    {
        return $this->http->post('https://api.openai.com/v1/chat/completions', ['json' => ['model' => $model, 'max_tokens' => $maxTokens, 'messages' => [['role' => 'user', 'content' => $text]]]]);
    }

    public function forecast(string $city, string $version = '2024-06-01')
    {
        return $this->http->get('https://api.example-weather.com/v2/forecast', ['query' => ['city' => $city], 'headers' => ['X-Api-Version' => $version]]);
    }

    public function translateBoth(string $text)
    {
        $this->translate($text);
        return $this->translate($text, 'o3', 4096);
    }

    public function classifyWith(string $text, Settings $settings)
    {
        $this->classify($text);
        $this->forecast('Lyon');
        $this->forecast('Oslo', $settings->version);
        $this->forecast('Rome', '2025-01-15');
        return $this->classify($text, $settings->pickModel(), $settings->limit);
    }
}
