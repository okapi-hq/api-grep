<?php

use Aws\BedrockRuntime\BedrockRuntimeClient;
use Aws\S3\S3Client;
use Mailgun\Mailgun;
use PostHog\PostHog;
use Resend;
use Twilio\Rest\Client;

function store(string $key, string $body)
{
    $s3 = new S3Client(['region' => 'eu-west-1', 'version' => 'latest']);
    return $s3->putObject(['Bucket' => 'uploads', 'Key' => $key, 'Body' => $body]);
}

function ask(string $prompt)
{
    $bedrock = new BedrockRuntimeClient(['region' => 'us-east-1', 'version' => 'latest']);
    return $bedrock->invokeModel(['modelId' => 'anthropic.claude-3-haiku-20240307-v1:0', 'body' => json_encode(['prompt' => $prompt])]);
}

function sms(string $to)
{
    $twilio = new Client('AC123', 'token');
    return $twilio->messages->create($to, ['from' => '+15550000000', 'body' => 'Hello']);
}

function verify(string $to)
{
    $twilio = new Client('AC123', 'token');
    return $twilio->verify->v2->services('VA123')->verifications->create($to, 'sms');
}

function email(string $to)
{
    $resend = Resend::client(getenv('RESEND_API_KEY'));
    return $resend->emails->send(['from' => 'app@example.com', 'to' => $to, 'subject' => 'Hi', 'html' => '<p>Hi</p>']);
}

function newsletter(string $to)
{
    return Mailgun::create(getenv('MAILGUN_KEY'))->messages()->send('example.com', ['to' => $to, 'subject' => 'News']);
}

function track(string $user)
{
    PostHog::init('phc_key', ['host' => 'https://eu.i.posthog.com']);
    PostHog::capture(['distinctId' => $user, 'event' => 'signed_up']);
}

function send(\SendGrid\Mail\Mail $mail)
{
    $sendgrid = new \SendGrid(getenv('SENDGRID_API_KEY'));
    return $sendgrid->send($mail);
}
