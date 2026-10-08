<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;

class Intercom
{
    private const BASE = 'https://api.intercom.io';

    private function request(string $method, string $path, array $body = [])
    {
        return Http::withToken(config('services.intercom.token'))->send($method, self::BASE . $path, ['json' => $body]);
    }

    public function contacts()
    {
        return $this->request('GET', '/contacts');
    }

    public function tag(string $contactId, string $tagId)
    {
        return $this->request('POST', "/contacts/{$contactId}/tags", ['id' => $tagId]);
    }
}
