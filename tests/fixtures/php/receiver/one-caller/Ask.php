<?php

namespace App\Assistant;

use OpenAI;

function ask($client, $prompt)
{
    return $client->chat()->create(['model' => 'gpt-4o-mini', 'messages' => [['role' => 'user', 'content' => $prompt]]]);
}

function main()
{
    $client = OpenAI::client(getenv('OPENAI_API_KEY'));
    return ask($client, 'hello');
}
