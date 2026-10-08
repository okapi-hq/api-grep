<?php

const PAGERDUTY = 'https://events.pagerduty.com';

function enqueue(array $event)
{
    $ch = curl_init(PAGERDUTY . '/v2/enqueue');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($event));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $out = curl_exec($ch);
    curl_close($ch);
    return $out;
}

function subscribe(string $email, string $key)
{
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://api.mailgun.net/v3/lists/news@example.com/members',
        CURLOPT_USERPWD => "api:$key",
        CURLOPT_POSTFIELDS => http_build_query(['address' => $email, 'subscribed' => 'yes']),
        CURLOPT_RETURNTRANSFER => true,
    ]);
    return curl_exec($ch);
}

function remove(string $id)
{
    $ch = curl_init("https://api.airtable.com/v0/app123/Tasks/{$id}");
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer " . getenv('AIRTABLE_TOKEN')]);
    return curl_exec($ch);
}

function upload(string $file)
{
    $ch = curl_init('https://api.cloudinary.com/v1_1/demo/image/upload');
    curl_setopt($ch, CURLOPT_POSTFIELDS, ['file' => new CURLFile($file), 'upload_preset' => 'demo']);
    return curl_exec($ch);
}
