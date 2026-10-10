<?php

function invoice($id)
{
    $url = str_replace('{id}', $id, 'https://api.example-billing.com/v1/invoices/{id}');
    return (new \GuzzleHttp\Client())->get($url);
}

function health($base)
{
    $root = preg_replace('#/+$#', '', $base ?? 'https://api.example-billing.com');
    return (new \GuzzleHttp\Client())->get($root . '/health');
}
