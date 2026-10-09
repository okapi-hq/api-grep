<?php

namespace App\Services;

use App\Config\Endpoints;
use GuzzleHttp\Client;
use function App\Config\api_path;
use const App\Config\CAL_API;

class Pages
{
    private const BASE = 'https://api.unsplash.com';

    public function __construct(private Client $client)
    {
    }

    public function page(string $pageId)
    {
        return $this->client->get(NOTION_API . "/pages/{$pageId}");
    }

    public function viewer()
    {
        return $this->client->post(Endpoints::LINEAR . '/graphql', ['json' => ['query' => '{ viewer { id } }']]);
    }

    public function projects()
    {
        return $this->client->get(Endpoints::$vercel . '/v9/projects');
    }

    public function booking(string $uid)
    {
        return $this->client->get(sprintf('%s/v1/bookings/%s', CAL_API, $uid), ['query' => ['apiKey' => getenv('CAL_KEY')]]);
    }

    public function photos(string $q)
    {
        $url = self::BASE;
        $url .= '/search/photos';
        return $this->client->get($url, ['query' => ['query' => $q]]);
    }

    public function heredoc(int $id)
    {
        $url = <<<URL
        https://api.cal.com/v1/teams/{$id}/users
        URL;
        return $this->client->get($url);
    }

    public function analytics()
    {
        return $this->client->post($_ENV['ANALYTICS_HOST'] . '/v1/batch', ['json' => []]);
    }
}
