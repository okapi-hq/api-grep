<?php

namespace App\Bots;

use Illuminate\Support\Facades\Http;

function api_url(string $method): string
{
    return 'https://api.telegram.org/bot' . env('TELEGRAM_TOKEN') . '/' . $method;
}

class Telegram
{
    private function graph(string $path): string
    {
        return "https://graph.facebook.com/v19.0/{$path}";
    }

    public function send(int $chatId, string $text)
    {
        return Http::post(api_url('sendMessage'), ['chat_id' => $chatId, 'text' => $text]);
    }

    public function feed(string $pageId)
    {
        return Http::get($this->graph($pageId . '/feed'));
    }
}
