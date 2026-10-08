<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class Notifier
{
    public function mail(string $to)
    {
        return Http::withBasicAuth('api', config('services.mailgun.secret'))
            ->asForm()
            ->post(config('services.mailgun.endpoint') . '/v3/' . config('services.mailgun.domain') . '/messages', ['to' => $to, 'subject' => 'Hi']);
    }

    public function slack(string $channel, string $text)
    {
        return Http::withToken(env('SLACK_BOT_TOKEN'))->acceptJson()->timeout(10)->post('https://slack.com/api/chat.postMessage', [
            'channel' => $channel,
            'text' => $text,
        ]);
    }

    public function contact(string $id)
    {
        return Http::baseUrl(config('services.hubspot.url'))
            ->withHeaders(['Authorization' => 'Bearer ' . config('services.hubspot.token')])
            ->get("/crm/v3/objects/contacts/{$id}", ['properties' => 'email']);
    }

    public function raw(string $method, string $url)
    {
        return Http::send($method, $url, ['json' => ['ping' => true]]);
    }

    public function fake()
    {
        Http::fake(['api.stripe.com/*' => Http::response([], 200)]);
    }
}
