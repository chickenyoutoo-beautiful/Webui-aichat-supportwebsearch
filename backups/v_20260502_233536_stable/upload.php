<?php
/**
 * OneAPIChat 图片上传 API v2 (安全加固)
 * POST: 上传图片，返回 URL
 * GET: 获取图片
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uploadDir = __DIR__ . '/uploads/';
if (!is_dir($uploadDir)) {
    if (!@mkdir($uploadDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Cannot create upload directory']);
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $filename = '';
    $imageData = null;
    
    // 支持 multipart/form-data 和 base64 JSON
    if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $tmpFile = $_FILES['image']['tmp_name'];
        $imageData = @file_get_contents($tmpFile);
        $origName = $_FILES['image']['name'];
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    } else {
        $input = file_get_contents('php://input');
        if ($input === false || $input === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Empty request body']);
            exit;
        }
        $data = json_decode($input, true);
        if (!$data || !isset($data['image'])) {
            http_response_code(400);
            echo json_encode(['error' => 'No image data provided']);
            exit;
        }
        
        $imageRaw = $data['image'];
        if (preg_match('/^data:image/(w+);base64,(.+)$/s', $imageRaw, $matches)) {
            $ext = strtolower($matches[1]);
            $imageData = base64_decode($matches[2]);
        } else {
            $imageData = base64_decode($imageRaw);
            $ext = 'png';
        }
    }
    
    if (!$imageData || strlen($imageData) === 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid or empty image data']);
        exit;
    }
    
    // 验证文件类型（只允许常见图片格式）
    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif'];
    if (!in_array($ext, $allowedExts)) {
        $ext = 'png'; // 未知扩展名默认 png
    }
    
    // 检查是否为真实图片（svg 除外）
    if (!in_array($ext, ['svg'])) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $detectedMime = finfo_buffer($finfo, $imageData);
        finfo_close($finfo);
        $validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-icon'];
        $allowed = false;
        foreach ($validMimes as $vm) {
            if (strpos($detectedMime, $vm) === 0) { $allowed = true; break; }
        }
        if (!$allowed) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid image type: ' . $detectedMime]);
            exit;
        }
    }
    
    // 限制文件大小: 10MB
    $maxSize = 10 * 1024 * 1024;
    if (strlen($imageData) > $maxSize) {
        http_response_code(413);
        echo json_encode(['error' => 'Image too large (max 10MB)']);
        exit;
    }
    
    // 安全生成文件名（防遍历、防重复）
    $hash = substr(hash('sha256', $imageData), 0, 12);
    $filename = 'img_' . $hash . '.' . $ext;
    $filepath = $uploadDir . $filename;
    
    if (file_put_contents($filepath, $imageData, LOCK_EX) !== false) {
        $url = '/oneapichat/uploads/' . rawurlencode($filename);
        echo json_encode([
            'url' => $url,
            'path' => $filepath,
            'size' => strlen($imageData),
            'type' => $ext
        ]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save image']);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // 获取所有已上传的图片列表
    $images = glob($uploadDir . '*.{jpg,jpeg,png,gif,webp,bmp,svg,ico,tiff}', GLOB_BRACE);
    $list = [];
    if ($images !== false) {
        foreach ($images as $img) {
            $list[] = [
                'filename' => basename($img),
                'url' => '/oneapichat/uploads/' . rawurlencode(basename($img)),
                'size' => filesize($img)
            ];
        }
    }
    echo json_encode(['images' => $list], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
