<?php

function meta()
{
    return file_get_contents("https://api.github.com/meta");
}
