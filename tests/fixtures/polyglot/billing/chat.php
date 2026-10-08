<?php

function ask(string $q)
{
    $client = OpenAI::client(getenv('OPENAI_API_KEY'));
    return $client->chat()->create(['model' => 'gpt-4o', 'messages' => [['role' => 'user', 'content' => $q]]]);
}
