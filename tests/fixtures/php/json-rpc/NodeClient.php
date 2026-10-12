<?php

use GuzzleHttp\Client;

const NODE_URL = 'https://rpc.example-chain.net';

class NodeClient
{
    private Client $http;

    public function __construct()
    {
        $this->http = new Client();
    }

    public function height()
    {
        return $this->http->post(NODE_URL, ['json' => ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'getBlockHeight', 'params' => []]]);
    }

    private function call(string $method, array $params)
    {
        return $this->http->post(NODE_URL, ['json' => ['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => $params]]);
    }

    public function slot()
    {
        return $this->call('getSlot', []);
    }

    public function supply()
    {
        return $this->call('getSupply', []);
    }

    public function health()
    {
        return $this->call('getHealth', []);
    }

    public function balanceAndSlot(string $address)
    {
        return $this->http->post(NODE_URL, ['body' => json_encode([
            ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'getBalance', 'params' => [$address]],
            ['jsonrpc' => '2.0', 'id' => 2, 'method' => 'getSlot', 'params' => []],
        ])]);
    }

    public function transaction(bool $parsed, string $signature)
    {
        $method = $parsed ? 'getTransaction' : 'getSignatureStatuses';
        return $this->http->post(NODE_URL, ['json' => ['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => [$signature]]]);
    }

    public function info(string $kind, string $address)
    {
        return $this->http->post(NODE_URL, ['json' => ['jsonrpc' => '2.0', 'id' => 1, 'method' => "get{$kind}Info", 'params' => [$address]]]);
    }
}
