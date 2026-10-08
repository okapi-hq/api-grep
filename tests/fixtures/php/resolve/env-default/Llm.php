<?php

use Illuminate\Support\Facades\Http;

function complete(string $prompt)
{
    $base = env('LANGDOCK_BASE_URL', 'https://api.langdock.com/openai/eu/v1');
    return Http::post("{$base}/chat/completions", ['model' => 'gpt-4o', 'messages' => [['role' => 'user', 'content' => $prompt]]]);
}

function speak(string $voiceId, string $text)
{
    $base = getenv('ELEVENLABS_URL') ?: 'https://api.elevenlabs.io';
    return Http::post("$base/v1/text-to-speech/$voiceId", ['text' => $text]);
}
