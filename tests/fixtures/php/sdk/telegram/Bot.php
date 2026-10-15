<?php

namespace App;

use Telegram\Bot\Api;
use Telegram\Bot\Laravel\Facades\Telegram;

class Notifier
{
    private Api $telegram;

    public function __construct()
    {
        $this->telegram = new Api(getenv('TELEGRAM_BOT_TOKEN'));
    }

    public function send(int $chatId, string $text): void
    {
        $this->telegram->sendMessage(['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'HTML']);
    }

    public function photo(int $chatId): void
    {
        Telegram::sendPhoto(['chat_id' => $chatId, 'photo' => 'https://example.com/a.png']);
    }

    public function hook(): void
    {
        Telegram::bot('mybot')->setWebhook(['url' => 'https://example.com/hook']);
        $this->telegram->getMe();
        $this->telegram->removeWebhook();
    }
}
