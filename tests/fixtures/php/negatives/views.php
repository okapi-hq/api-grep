<?php

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

const DOCS_URL = 'https://api.stripe.com/docs';

Route::get('/api/users', fn () => response()->json([]));

function render()
{
    return view('welcome', ['link' => DOCS_URL, 'logo' => 'https://images.example.com/logo.png']);
}

function settings()
{
    return file_get_contents(__DIR__ . '/../config/app.json');
}

function query(\Illuminate\Http\Request $request)
{
    return $request->get('url');
}

function testing()
{
    Http::fake(['api.github.com/*' => Http::response(['ok' => true])]);
    Http::assertSent(fn ($request) => $request->url() === 'https://api.github.com/meta');
}
