<?php

final class Upstream
{
    public function __construct(public string $base, public string $path, public string $method = 'GET')
    {
    }
}

final class Endpoint
{
    public string $url;

    public function __construct(string $host, string $path = '/v1/status')
    {
        $this->url = 'https://' . $host . $path;
    }
}

function callUpstream(Upstream $call)
{
    $http = new \GuzzleHttp\Client();
    return $http->request($call->method, $call->base . $call->path);
}

function fetchStatus(Endpoint $endpoint)
{
    $http = new \GuzzleHttp\Client();
    return $http->get($endpoint->url);
}

callUpstream(new Upstream(base: 'https://api.example-weather.com', path: '/v1/forecast'));
callUpstream(new Upstream('https://api.example-weather.com', '/v1/plans', 'POST'));
fetchStatus(new Endpoint('api.example-status.com', path: '/v1/jobs'));
