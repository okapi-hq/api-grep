<?php

namespace App\Support;

class Tagger
{
    public function tag($client, string $text)
    {
        return $client->messages->create(maxTokens: 8, messages: [['role' => 'user', 'content' => $text]], model: 'claude-haiku-4-5');
    }
}
