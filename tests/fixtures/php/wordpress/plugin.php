<?php

function myplugin_subscribe($email)
{
    return wp_remote_post('https://api.convertkit.com/v3/forms/123/subscribe', [
        'body' => ['email' => $email, 'api_key' => get_option('ck_key')],
        'timeout' => 15,
    ]);
}

function myplugin_rates()
{
    return wp_remote_get('https://open.er-api.com/v6/latest/USD', ['headers' => ['Accept' => 'application/json']]);
}

function myplugin_delete($id)
{
    return wp_remote_request("https://api.example.com/v1/items/{$id}", ['method' => 'DELETE']);
}
