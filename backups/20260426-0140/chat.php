<?php
/**
 * OneAPIChat 聊天记录存储 API v2 (安全加固)
 * POST: 保存聊天记录
 * GET: 获取聊天记录列表或单条
 * DELETE: 删除聊天记录
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataDir = __DIR__ . '/chat_data/';
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create data directory']);
        exit;
    }
}

// 验证 dataDir 是否可写
if (!is_writable($dataDir)) {
    http_response_code(500);
    echo json_encode(['error' => 'Data directory not writable']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$deviceId = isset($_GET['device_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['device_id']) : 'default';
if (strlen($deviceId) > 64 || strlen($deviceId) < 1) {
    $deviceId = 'default';
}

switch ($method) {
    case 'POST':
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Empty request body']);
            exit;
        }
        $data = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid JSON: ' . json_last_error_msg()]);
            exit;
        }
        if (!isset($data['chat_id']) || !is_string($data['chat_id']) || trim($data['chat_id']) === '') {
            http_response_code(400);
            echo json_encode(['error' => 'chat_id required']);
            exit;
        }
        
        $chatId = preg_replace('/[^a-zA-Z0-9_-]/', '', $data['chat_id']);
        if (strlen($chatId) < 1 || strlen($chatId) > 128) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid chat_id']);
            exit;
        }
        
        $filename = $dataDir . $deviceId . '_' . $chatId . '.json';
        // 防止路径穿越
        if (strpos(realpath(dirname($filename)), realpath($dataDir)) !== 0) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid path']);
            exit;
        }
        
        $data['updated_at'] = date('c');
        $jsonData = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if ($jsonData === false) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to encode data']);
            exit;
        }
        
        if (@file_put_contents($filename, $jsonData, LOCK_EX) !== false) {
            echo json_encode(['success' => true, 'path' => basename($filename)]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save chat']);
        }
        break;

    case 'GET':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;
        
        if ($chatId) {
            if (strlen($chatId) < 1 || strlen($chatId) > 128) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid chat_id']);
                exit;
            }
            $filename = $dataDir . $deviceId . '_' . $chatId . '.json';
            if (file_exists($filename)) {
                readfile($filename);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Chat not found']);
            }
        } else {
            $chats = [];
            $pattern = $dataDir . $deviceId . '_*.json';
            $files = glob($pattern);
            if ($files === false) {
                echo json_encode(['chats' => []]);
                break;
            }
            foreach ($files as $file) {
                $basename = basename($file, '.json');
                $chatIdFromFile = substr($basename, strlen($deviceId) + 1);
                $content = @json_decode(@file_get_contents($file), true);
                if ($content && isset($content['messages'])) {
                    // 生成标题：使用第一条用户消息
                    $title = $content['title'] ?? null;
                    if (!$title && !empty($content['messages'])) {
                        foreach ($content['messages'] as $msg) {
                            if (($msg['role'] ?? '') === 'user' && !empty($msg['content'])) {
                                $text = is_string($msg['content']) ? $msg['content'] : 
                                       (is_array($msg['content']) ? ($msg['content'][0]['text'] ?? '') : '');
                                $title = mb_strlen($text) > 30 ? mb_substr($text, 0, 30) . '...' : $text;
                                break;
                            }
                        }
                    }
                    $chats[] = [
                        'chat_id' => $chatIdFromFile,
                        'title' => $title ?: '新对话',
                        'message_count' => count($content['messages']),
                        'updated_at' => $content['updated_at'] ?? $content['created_at'] ?? null
                    ];
                }
            }
            usort($chats, function($a, $b) {
                return strcmp($b['updated_at'] ?? '', $a['updated_at'] ?? '');
            });
            echo json_encode(['chats' => $chats], JSON_UNESCAPED_UNICODE);
        }
        break;

    case 'DELETE':
        $chatId = isset($_GET['chat_id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['chat_id']) : null;
        if (!$chatId || strlen($chatId) < 1) {
            http_response_code(400);
            echo json_encode(['error' => 'chat_id required']);
            exit;
        }
        $filename = $dataDir . $deviceId . '_' . $chatId . '.json';
        if (file_exists($filename)) {
            if (@unlink($filename)) {
                echo json_encode(['success' => true]);
            } else {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to delete']);
            }
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Chat not found']);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}
