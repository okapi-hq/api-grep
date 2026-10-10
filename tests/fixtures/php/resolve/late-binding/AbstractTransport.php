<?php

namespace Acme\Notifier;

use Symfony\Contracts\HttpClient\HttpClientInterface;

abstract class AbstractTransport
{
    protected const HOST = 'localhost';
    protected ?string $host = null;
    protected ?int $port = null;

    public function __construct(protected HttpClientInterface $client)
    {
    }

    protected function getEndpoint(): string
    {
        return ($this->host ?: static::HOST) . ($this->port ? ':' . $this->port : '');
    }
}
