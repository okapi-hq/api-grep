<?php

use Sentry\Laravel\Integration;

function boot()
{
    \Sentry\init(['dsn' => 'https://public@o0.ingest.sentry.io/0']);
}
