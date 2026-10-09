<?php

use function Sentry\captureMessage;

\Sentry\init(['dsn' => 'https://public@o0.ingest.sentry.io/0']);

function report(\Throwable $e)
{
    \Sentry\captureException($e);
}

function warn(string $msg)
{
    captureMessage($msg);
}

function track(\Throwable $e)
{
    report($e);
}
