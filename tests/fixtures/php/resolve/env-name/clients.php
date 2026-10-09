<?php

use Illuminate\Support\Facades\Http;

function models()
{
    return Http::get(env('OPENROUTER_BASE_URL') . '/models');
}

function transcribe(string $audioUrl)
{
    return Http::post($_ENV['GLADIA_API_URL'] . '/v2/transcription', ['audio_url' => $audioUrl]);
}
