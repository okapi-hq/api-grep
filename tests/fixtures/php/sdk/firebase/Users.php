<?php

namespace App\Firebase;

use Google\Cloud\Firestore\FirestoreClient;
use Kreait\Firebase\Contract\Auth;
use Kreait\Firebase\Factory;

class Users
{
    private FirestoreClient $db;

    public function __construct(private Auth $auth)
    {
        $this->db = (new Factory())->withServiceAccount('service-account.json')->createFirestore()->database();
    }

    public function signup(string $email)
    {
        return $this->auth->createUser(['email' => $email, 'emailVerified' => false]);
    }

    public function save(string $uid, array $data)
    {
        return $this->db->collection('users')->document($uid)->set($data);
    }

    public function post(string $uid, string $text)
    {
        return $this->db->collection('users')->document($uid)->collection('posts')->add(['text' => $text]);
    }

    public function notify(string $token)
    {
        $messaging = (new Factory())->createMessaging();
        return $messaging->send(['token' => $token, 'notification' => ['title' => 'Hi']]);
    }

    public function token(string $uid)
    {
        return $this->auth->createCustomToken($uid);
    }
}
