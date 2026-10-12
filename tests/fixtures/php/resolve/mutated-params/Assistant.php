<?php

namespace App\Assistant;

use GuzzleHttp\Client;
use OpenAI;

function complete(string $prompt, bool $reasoning)
{
    $client = OpenAI::client(getenv('OPENAI_API_KEY'));
    $params = ['model' => 'gpt-4o-mini', 'messages' => [['role' => 'user', 'content' => $prompt]]];
    if ($reasoning) {
        $params['max_completion_tokens'] = 64;
    } else {
        $params['max_tokens'] = 64;
        $params['temperature'] = 0.2;
    }
    return $client->chat()->create($params);
}

function defaults(string $prompt, ?string $user)
{
    $client = OpenAI::client(getenv('OPENAI_API_KEY'));
    $params = ['messages' => [['role' => 'user', 'content' => $prompt]], 'seed' => 1];
    $params += ['model' => 'gpt-4.1', 'messages' => []];
    $params = array_merge($params, ['max_tokens' => 128]);
    unset($params['seed']);
    if ($user !== null) {
        $params['user'] = $user;
    }
    return $client->chat()->create($params);
}

function order(string $item)
{
    $payload['item'] = $item;
    $payload['quantity'] = 1;
    $http = new Client(['base_uri' => 'https://api.example-shop.com']);
    return $http->post('/v1/orders', ['json' => $payload]);
}
