<?php

use GuzzleHttp\Client;

const STORE_API = 'https://api.example-store.com/graphql';

class StoreClient
{
    private Client $http;

    public function __construct()
    {
        $this->http = new Client();
    }

    public function product(string $id)
    {
        $query = <<<'GRAPHQL'
        query GetProduct($id: ID!) {
          product(id: $id) { title price: priceRange { min { amount } } }
        }
        GRAPHQL;
        return $this->http->post(STORE_API, ['json' => ['query' => $query, 'variables' => ['id' => $id]]]);
    }

    private function run(string $query, array $variables = [])
    {
        return $this->http->post(STORE_API, ['json' => ['query' => $query, 'variables' => $variables]]);
    }

    public function addToCart(string $cartId, string $lineId)
    {
        return $this->run('mutation AddLine($cart: ID!, $line: ID!) { cartLinesAdd(cartId: $cart, lines: [{merchandiseId: $line}]) { cart { id } } }', ['cart' => $cartId, 'line' => $lineId]);
    }

    public function shop()
    {
        return $this->run('{ shop { name } }');
    }
}
