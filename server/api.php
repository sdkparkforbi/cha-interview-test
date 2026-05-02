<?php
/**
 * cha-interview-bot - 면담봇 API
 * 베이스: finmarket-api/api.php 패턴
 * DB: cha_interview_db
 */
date_default_timezone_set('Asia/Seoul');
error_reporting(E_ALL);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');
$allowed_origins = array(
    'https://cha-interview-bot.vercel.app',
    'https://aiforalab.com',
    'http://localhost:5173',
    'http://localhost:3000',
);
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $allowed_origins)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ─── DB ───
$db_host = 'localhost';
$db_name = 'cha_interview_db';
$db_user = 'user2';
$db_pass = 'user2!!';
$JWT_SECRET = 'cha_interview_jwt_secret_2026';

try {
    $pdo = new PDO(
        "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4",
        $db_user, $db_pass,
        array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC)
    );
} catch (PDOException $e) {
    echo json_encode(array('success' => false, 'error' => 'DB connection failed'));
    exit;
}

// ─── Routing ───
$action = '';
$input = array();
if (isset($_GET['action'])) $action = $_GET['action'];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true);
    if (!$input) $input = array();
    if (!$action && isset($input['action'])) $action = $input['action'];
} else {
    $input = $_GET;
}

switch ($action) {
    case 'health':
        echo json_encode(array('status' => 'ok', 'service' => 'cha-interview-bot API'));
        break;
    case 'kakao_login':
        handleKakaoLogin($pdo, $input);
        break;
    case 'email_signup':
        handleEmailSignup($pdo, $input);
        break;
    case 'email_login':
        handleEmailLogin($pdo, $input);
        break;
    case 'verify':
        handleVerify($pdo, $input);
        break;
    case 'save_chat':
        handleSaveChat($pdo, $input);
        break;
    case 'list_chats':
        handleListChats($pdo, $input);
        break;
    default:
        echo json_encode(array('success' => false, 'error' => 'Unknown action: ' . $action));
}

// ─── Password Hash (PHP 5.4 호환 — crypt() bcrypt 직접 사용) ───
function pwHash($password) {
    // bcrypt $2y$10$ 형식 22자 salt
    $bytes = openssl_random_pseudo_bytes(16);
    $b64 = strtr(rtrim(base64_encode($bytes), '='), '+', '.');
    $salt = '$2y$10$' . substr($b64, 0, 22);
    return crypt($password, $salt);
}
function pwVerify($password, $hash) {
    if (!$hash || strlen($hash) < 7) return false;
    $check = crypt($password, $hash);
    if (function_exists('hash_equals')) return hash_equals($hash, $check);
    return $hash === $check;
}

// ─── JWT ───
function createJWT($userId, $secret) {
    $header = base64_encode(json_encode(array('typ' => 'JWT', 'alg' => 'HS256')));
    $payload = base64_encode(json_encode(array('user_id' => $userId, 'exp' => time() + 86400 * 7)));
    $sig = base64_encode(hash_hmac('sha256', "$header.$payload", $secret, true));
    return "$header.$payload.$sig";
}

function verifyJWT($token, $secret) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    $sig = base64_encode(hash_hmac('sha256', $parts[0] . '.' . $parts[1], $secret, true));
    if ($sig !== $parts[2]) return null;
    $payload = json_decode(base64_decode($parts[1]), true);
    if (!$payload || $payload['exp'] < time()) return null;
    return $payload;
}

function getUserFromToken($pdo, $input) {
    global $JWT_SECRET;
    $token = '';
    if (isset($input['token'])) $token = $input['token'];
    if (!$token && isset($_GET['token'])) $token = $_GET['token'];
    if (!$token && isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth = $_SERVER['HTTP_AUTHORIZATION'];
        if (preg_match('/Bearer\s+(.+)/', $auth, $m)) $token = $m[1];
    }
    if (!$token) return null;
    $payload = verifyJWT($token, $JWT_SECRET);
    if (!$payload) return null;
    return $payload;
}

// ─── Kakao Login ───
function handleKakaoLogin($pdo, $input) {
    global $JWT_SECRET;
    $kakao_id = isset($input['kakao_id']) ? trim($input['kakao_id']) : '';
    $nickname = isset($input['nickname']) ? trim($input['nickname']) : '';
    $email    = isset($input['email'])    ? trim($input['email'])    : null;

    if (empty($kakao_id) || empty($nickname)) {
        echo json_encode(array('success' => false, 'error' => 'kakao_id and nickname required'));
        return;
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE kakao_id = ?');
    $stmt->execute(array($kakao_id));
    $user = $stmt->fetch();

    if ($user) {
        $pdo->prepare('UPDATE users SET visit_count = visit_count + 1, last_login = NOW(), name = ?, email = COALESCE(?, email) WHERE kakao_id = ?')
            ->execute(array($nickname, $email, $kakao_id));
        $stmt = $pdo->prepare('SELECT * FROM users WHERE kakao_id = ?');
        $stmt->execute(array($kakao_id));
        $user = $stmt->fetch();
    } else {
        $stmt = $pdo->prepare('INSERT INTO users (kakao_id, name, email, visit_count, last_login) VALUES (?, ?, ?, 1, NOW())');
        $stmt->execute(array($kakao_id, $nickname, $email));
        $user = array(
            'id' => $pdo->lastInsertId(),
            'kakao_id' => $kakao_id,
            'name' => $nickname,
            'email' => $email,
            'visit_count' => 1
        );
    }

    $token = createJWT($user['id'], $JWT_SECRET);
    echo json_encode(array(
        'success' => true,
        'token' => $token,
        'user' => array(
            'id' => $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'visit_count' => $user['visit_count']
        )
    ));
}

// ─── Email Signup ───
function handleEmailSignup($pdo, $input) {
    global $JWT_SECRET;
    $email    = isset($input['email'])    ? trim($input['email'])    : '';
    $password = isset($input['password']) ? $input['password']        : '';
    $name     = isset($input['name'])     ? trim($input['name'])     : '';

    if (!$email || !$password || !$name) {
        echo json_encode(array('success' => false, 'error' => 'email, password, name required'));
        return;
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(array('success' => false, 'error' => 'invalid email'));
        return;
    }
    if (strlen($password) < 6) {
        echo json_encode(array('success' => false, 'error' => 'password too short (min 6)'));
        return;
    }

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute(array($email));
    if ($stmt->fetch()) {
        echo json_encode(array('success' => false, 'error' => 'email already registered'));
        return;
    }

    $hash = pwHash($password);
    $stmt = $pdo->prepare('INSERT INTO users (email, password_hash, name, visit_count, last_login) VALUES (?, ?, ?, 1, NOW())');
    $stmt->execute(array($email, $hash, $name));
    $userId = $pdo->lastInsertId();

    $token = createJWT($userId, $JWT_SECRET);
    echo json_encode(array(
        'success' => true,
        'token' => $token,
        'user' => array('id' => $userId, 'name' => $name, 'email' => $email, 'visit_count' => 1)
    ));
}

// ─── Email Login ───
function handleEmailLogin($pdo, $input) {
    global $JWT_SECRET;
    $email    = isset($input['email'])    ? trim($input['email'])    : '';
    $password = isset($input['password']) ? $input['password']        : '';

    if (!$email || !$password) {
        echo json_encode(array('success' => false, 'error' => 'email and password required'));
        return;
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute(array($email));
    $user = $stmt->fetch();
    if (!$user || !$user['password_hash'] || !pwVerify($password, $user['password_hash'])) {
        echo json_encode(array('success' => false, 'error' => 'invalid email or password'));
        return;
    }

    $pdo->prepare('UPDATE users SET visit_count = visit_count + 1, last_login = NOW() WHERE id = ?')
        ->execute(array($user['id']));

    $token = createJWT($user['id'], $JWT_SECRET);
    echo json_encode(array(
        'success' => true,
        'token' => $token,
        'user' => array('id' => $user['id'], 'name' => $user['name'], 'email' => $user['email'], 'visit_count' => $user['visit_count'] + 1)
    ));
}

// ─── Verify Token ───
function handleVerify($pdo, $input) {
    $payload = getUserFromToken($pdo, $input);
    if (!$payload) {
        echo json_encode(array('success' => false, 'error' => 'invalid token'));
        return;
    }
    $stmt = $pdo->prepare('SELECT id, name, email, kakao_id, visit_count FROM users WHERE id = ?');
    $stmt->execute(array($payload['user_id']));
    $user = $stmt->fetch();
    echo json_encode(array('success' => true, 'user' => $user));
}

// ─── Save Chat ───
function handleSaveChat($pdo, $input) {
    $session_id = isset($input['session_id']) ? trim($input['session_id']) : '';
    $role       = isset($input['role'])       ? $input['role']             : '';
    $message    = isset($input['message'])    ? trim($input['message'])    : '';
    $rag_hits   = isset($input['rag_hits'])   ? $input['rag_hits']         : null;

    if (!$session_id || !in_array($role, array('user','assistant')) || !$message) {
        echo json_encode(array('success' => false, 'error' => 'session_id, role(user|assistant), message required'));
        return;
    }
    if (is_array($rag_hits)) $rag_hits = json_encode($rag_hits, JSON_UNESCAPED_UNICODE);

    $payload = getUserFromToken($pdo, $input);
    $user_id = $payload ? $payload['user_id'] : null;

    $stmt = $pdo->prepare('INSERT INTO chat_logs (user_id, session_id, role, message, rag_hits) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute(array($user_id, $session_id, $role, $message, $rag_hits));
    echo json_encode(array('success' => true, 'id' => $pdo->lastInsertId()));
}

// ─── List Chats (사용자 본인 + admin은 다 볼 수 있게 — 일단 본인만) ───
function handleListChats($pdo, $input) {
    $payload = getUserFromToken($pdo, $input);
    if (!$payload) {
        echo json_encode(array('success' => false, 'error' => 'login required'));
        return;
    }
    $limit = isset($input['limit']) ? max(1, min(500, (int)$input['limit'])) : 100;
    $stmt = $pdo->prepare('SELECT id, session_id, role, message, created_at FROM chat_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ' . $limit);
    $stmt->execute(array($payload['user_id']));
    echo json_encode(array('success' => true, 'rows' => $stmt->fetchAll()));
}
