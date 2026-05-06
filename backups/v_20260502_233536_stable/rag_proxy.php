<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = $_GET['action'] ?? '';
$rag_url = 'http://127.0.0.1:8765';
$collection_param = '';

if (!empty($_GET['collection'])) {
    $collection_param = '?collection=' . urlencode($_GET['collection']);
}

function proxy_get($url) {
    return @file_get_contents($url);
}

function proxy_post($url, $body, $timeout = 10) {
    $opts = ['http' => [
        'method' => 'POST',
        'header' => 'Content-Type: application/json',
        'content' => $body,
        'timeout' => $timeout,
        'ignore_errors' => true
    ]];
    return @file_get_contents($url, false, stream_context_create($opts));
}

function proxy_upload($url) {
    if (!isset($_FILES['file'])) return json_encode(['error' => '没有收到文件']);
    $file = $_FILES['file'];
    $boundary = '----RAG' . md5(time());
    $body = '';
    $body .= '--' . $boundary . "\r\n";
    $body .= 'Content-Disposition: form-data; name="file"; filename="' . basename($file['name']) . "\"\r\n";
    $body .= "Content-Type: application/octet-stream\r\n\r\n";
    $body .= file_get_contents($file['tmp_name']) . "\r\n";
    $body .= '--' . $boundary . "--\r\n";
    $opts = ['http' => [
        'method' => 'POST',
        'header' => "Content-Type: multipart/form-data; boundary=$boundary\r\nContent-Length: " . strlen($body),
        'content' => $body,
        'timeout' => 30,
        'ignore_errors' => true
    ]];
    return @file_get_contents($url, false, stream_context_create($opts));
}

switch ($action) {
    case 'health':
        echo proxy_get("$rag_url/health$collection_param");
        break;
    case 'knowledge':
        echo proxy_get("$rag_url/knowledge$collection_param");
        break;
    case 'search':
        $body = file_get_contents('php://input');
        echo proxy_post("$rag_url/search$collection_param", $body, 10);
        break;
    case 'ask':
        $body = file_get_contents('php://input');
        echo proxy_post("$rag_url/ask$collection_param", $body, 60);
        break;
    case 'upload':
        $modeParam = isset($_GET['mode']) ? '&mode=' . urlencode($_GET['mode']) : '';
        echo proxy_upload("$rag_url/upload$collection_param$modeParam");
        break;
    case 'collections':
        $all = json_decode(proxy_get("$rag_url/collections"), true);
        $cols = $all['collections'] ?? [];
        // 提取用户ID前缀：collection=userId_default → userId_
        $ns = '';
        if (!empty($_GET['collection'])) {
            $parts = explode('_', $_GET['collection']);
            $ns = $parts[0] . '_';  // 用于过滤的命名空间前缀
        }
        $filtered = [];
        foreach ($cols as $c) {
            if (!$ns || strpos($c, $ns) === 0) {
                // 去掉用户ID前缀，只返回集合显示名
                $filtered[] = $ns ? substr($c, strlen($ns)) : $c;
            }
        }
        echo json_encode(['collections' => $filtered]);
        break;
    case 'create_collection':
        $name = $_GET['name'] ?? '';
        // 从collection参数提取用户前缀
        $ns = '';
        if (!empty($_GET['collection'])) {
            $parts = explode('_', $_GET['collection']);
            $ns = $parts[0] . '_';
        }
        $full_name = $ns . urlencode($name);
        echo proxy_get("$rag_url/create_collection?name=$full_name");
        break;
    case 'delete_collection':
        $name = $_GET['name'] ?? '';
        // build full namespaced name
        $ns = '';
        if (!empty($_GET['collection'])) {
            $parts = explode('_', $_GET['collection']);
            $ns = $parts[0] . '_';
        }
        $full_name = $ns . urlencode($name);
        echo proxy_get("$rag_url/delete_collection?name=$full_name");
        break;
    default:
        echo json_encode(['error' => 'unknown action']);
}
