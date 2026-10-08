<?php

namespace App\Clients;

use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;

class GitHub
{
    private Client $http;

    public function __construct(string $token)
    {
        $this->http = new Client([
            'base_uri' => 'https://api.github.com',
            'headers' => ['Authorization' => "Bearer {$token}", 'Accept' => 'application/vnd.github+json'],
        ]);
    }

    public function issues(string $owner, string $repo)
    {
        return $this->http->get("/repos/{$owner}/{$repo}/issues", ['query' => ['state' => 'open', 'per_page' => 50]]);
    }

    public function createIssue(string $owner, string $repo, string $title)
    {
        return $this->http->post("/repos/$owner/$repo/issues", ['json' => ['title' => $title, 'labels' => ['bug']]]);
    }

    public function dispatch(string $method, string $path)
    {
        return $this->http->request($method, $path);
    }
}

function send_sms(ClientInterface $client, string $to)
{
    return $client->request('POST', 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json', [
        'form_params' => ['To' => $to, 'Body' => 'Hello'],
        'auth' => ['AC123', 'token'],
    ]);
}

function upload(string $path)
{
    $client = new \GuzzleHttp\Client();
    return $client->postAsync('https://api.cloudinary.com/v1_1/demo/image/upload', ['multipart' => [['name' => 'file', 'contents' => fopen($path, 'r')]]]);
}

function drupal_ping()
{
    return \Drupal::httpClient()->get('https://api.notion.com/v1/users/me', ['headers' => ['Notion-Version' => '2022-06-28']]);
}
