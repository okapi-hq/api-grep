<?php

function meta()
{
    return file_get_contents('https://api.github.com/meta');
}

function post_event(array $event)
{
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAuthorization: Bearer token",
            'content' => json_encode($event),
        ],
    ]);
    return file_get_contents('https://api.mixpanel.com/track', false, $context);
}

function settings()
{
    return json_decode(file_get_contents(__DIR__ . '/settings.json'), true);
}

function input()
{
    return file_get_contents('php://input');
}
