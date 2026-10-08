<?php

use Github\Client;

function repos(Client $github)
{
    return $github->api('user')->repositories('acme');
}
