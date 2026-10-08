<?php

use Illuminate\Support\Facades\Http;

function do_fetch(string $url, array $payload)
{
    return Http::post($url, $payload);
}

function signed_fetch(string $path, array $payload)
{
    return do_fetch('https://api.mixpanel.com' . $path, $payload);
}

function tracked(string $event)
{
    return signed_fetch('/track', ['event' => $event]);
}

function deep(string $event)
{
    return tracked($event);
}
