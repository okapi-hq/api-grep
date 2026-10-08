<?php

return [
    'mailgun' => [
        'domain' => env('MAILGUN_DOMAIN'),
        'endpoint' => env('MAILGUN_ENDPOINT', 'https://api.mailgun.net'),
    ],
    'hubspot' => [
        'url' => 'https://api.hubapi.com',
    ],
];
