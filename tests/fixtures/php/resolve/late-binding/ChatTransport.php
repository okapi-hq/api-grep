<?php

namespace Acme\Notifier;

final class ChatTransport extends AbstractTransport
{
    protected const HOST = 'api.example-chat.com';

    public function push(array $message): void
    {
        $this->client->request('POST', 'https://' . $this->getEndpoint() . '/v2/bot/message/push', ['json' => $message]);
    }
}
