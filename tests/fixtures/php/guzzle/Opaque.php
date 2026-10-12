<?php

use GuzzleHttp\Client;

function send_event(Client $client, array $options)
{
    return $client->request('POST', 'https://api.segment.io/v1/track', $options);
}
