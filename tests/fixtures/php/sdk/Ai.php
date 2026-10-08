<?php

namespace App\Ai;

use Anthropic\Client as Anthropic;
use Gemini;
use OpenAI;
use OpenAI\Laravel\Facades\OpenAI as OpenAIFacade;

function chat(string $q)
{
    $client = OpenAI::client(getenv('OPENAI_API_KEY'));
    return $client->chat()->create(['model' => 'gpt-4o', 'messages' => [['role' => 'user', 'content' => $q]]]);
}

function routed(string $q)
{
    $client = OpenAI::factory()->withApiKey(getenv('OPENROUTER_KEY'))->withBaseUri('openrouter.ai/api/v1')->make();
    return $client->chat()->create(['model' => 'anthropic/claude-sonnet-4', 'messages' => []]);
}

function facade(string $text)
{
    return OpenAIFacade::embeddings()->create(['model' => 'text-embedding-3-small', 'input' => $text]);
}

function claude(string $text)
{
    $client = new Anthropic(apiKey: getenv('ANTHROPIC_API_KEY'));
    return $client->messages->create(maxTokens: 1024, messages: [['role' => 'user', 'content' => $text]], model: 'claude-sonnet-4-5');
}

function gemini(string $prompt)
{
    return Gemini::client(getenv('GEMINI_API_KEY'))->generativeModel(model: 'gemini-2.0-flash')->generateContent($prompt);
}
