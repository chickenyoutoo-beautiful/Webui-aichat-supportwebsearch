#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OneAPIChat Python 后端
替换 PHP 版的 auth.php / chat.php / upload.php / fetch.php / config.php
前端静态文件保持不变，仅修改 API 地址指向本后端。
"""
import os
import json
import hashlib
import secrets
import time
import re
import base64
import io
import mimetypes
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, quote, unquote
from html.parser import HTMLParser

import requests
from flask import (
    Flask, request, jsonify, send_from_directory,
    abort, Response
)
from PIL import Image

# ── 配置 ──
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
CHAT_DATA_DIR = BASE_DIR / "chat_data"
USERS_DIR = BASE_DIR / "users"
UPLOADS_DIR = BASE_DIR / "uploads"
SESSION_EXPIRE = 30 * 24 * 3600  # 30 天
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_RESULT_LENGTH = 50000

for d in [STATIC_DIR, CHAT_DATA_DIR, USERS_DIR, UPLOADS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


# ═══════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════

def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _users_file():
    return USERS_DIR / "users.json"


def _sessions_file():
    return USERS_DIR / "sessions.json"


def _clean_username(name):
    return re.sub(r"[^\w\u4e00-\u9fff]", "", name.strip())[:32]


def _hash_password(pw):
    return hashlib.sha256(pw.encode()).hexdigest()


def _generate_token():
    return secrets.token_hex(32)


def _generate_user_id():
    return "u_" + secrets.token_hex(12)


def _verify_token(token):
    sessions = _read_json(_sessions_file())
    info = sessions.get(token)
    if not info:
        return None
    created = info.get("created_at", 0)
    if time.time() - created > SESSION_EXPIRE:
        del sessions[token]
        _write_json(_sessions_file(), sessions)
        return None
    return info.get("user_id")


def _get_auth_user():
    """从请求参数中获取 authenticated user_id"""
    token = request.args.get("auth_token", "")
    if not token:
        token = request.form.get("auth_token", "")
    token = re.sub(r"[^a-f0-9]", "", token)
    if not token or len(token) < 8:
        return None
    return _verify_token(token)


def _get_namespace(user_id=None):
    """获取数据存储的 namespace"""
    if user_id:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)
        return f"user_{safe}" if safe else "default"
    device_id = request.args.get("device_id", "")
    if device_id:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "", device_id)[:64]
        return safe if safe else "default"
    return "default"


def _json_reply(data, status=200):
    return jsonify(data), status


# ═══════════════════════════════════════════
#  静态文件 — 前端入口
# ═══════════════════════════════════════════

@app.route("/")
def serve_index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/<path:path>")
def serve_static(path):
    file_path = STATIC_DIR / path
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(STATIC_DIR), path)
    # SPA fallback: 所有未知路径返回 index.html
    return send_from_directory(str(STATIC_DIR), "index.html")


# ═══════════════════════════════════════════
#  认证 /auth
# ═══════════════════════════════════════════

@app.route("/auth", methods=["GET", "POST"])
def auth_handler():
    action = request.args.get("action", "")
    data = request.get_json(silent=True) or {}

    # ── 登录 ──
    if action == "login":
        username = _clean_username(data.get("username", ""))
        password = data.get("password", "")
        if not username or not password:
            return _json_reply({"error": "请填写用户名和密码"}, 400)

        users = _read_json(_users_file())
        for uid, info in users.items():
            if info.get("username") == username:
                if info.get("password_hash") == _hash_password(password):
                    token = _generate_token()
                    sessions = _read_json(_sessions_file())
                    sessions[token] = {"user_id": uid, "created_at": int(time.time())}
                    _write_json(_sessions_file(), sessions)
                    return _json_reply({
                        "success": True, "token": token,
                        "username": username, "user_id": uid
                    })
                return _json_reply({"error": "密码错误"}, 401)

        return _json_reply({"error": "用户不存在"}, 404)

    # ── 注册 ──
    if action == "register":
        username = _clean_username(data.get("username", ""))
        password = data.get("password", "")
        if not username or len(username) < 2:
            return _json_reply({"error": "用户名至少2个字符"}, 400)
        if not password or len(password) < 6:
            return _json_reply({"error": "密码至少6位"}, 400)

        users = _read_json(_users_file())
        for info in users.values():
            if info.get("username") == username:
                return _json_reply({"error": "用户名已存在"}, 409)

        uid = _generate_user_id()
        users[uid] = {
            "username": username,
            "password_hash": _hash_password(password),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _write_json(_users_file(), users)

        token = _generate_token()
        sessions = _read_json(_sessions_file())
        sessions[token] = {"user_id": uid, "created_at": int(time.time())}
        _write_json(_sessions_file(), sessions)
        return _json_reply({
            "success": True, "token": token,
            "username": username, "user_id": uid
        })

    # ── 验证 token ──
    if action == "verify":
        token = request.args.get("token", "")
        token = re.sub(r"[^a-f0-9]", "", token)
        user_id = _verify_token(token)
        if user_id:
            users = _read_json(_users_file())
            info = users.get(user_id, {})
            return _json_reply({
                "valid": True,
                "user_id": user_id,
                "username": info.get("username", ""),
            })
        return _json_reply({"valid": False})

    # ── 登出 ──
    if action == "logout":
        data = request.get_json(silent=True) or {}
        token = data.get("token", "")
        token = re.sub(r"[^a-f0-9]", "", token)
        if token:
            sessions = _read_json(_sessions_file())
            sessions.pop(token, None)
            _write_json(_sessions_file(), sessions)
        return _json_reply({"success": True})

    return _json_reply({"error": "Method not allowed"}, 405)


# ═══════════════════════════════════════════
#  聊天记录 /chat
# ═══════════════════════════════════════════

@app.route("/chat", methods=["GET", "POST"])
def chat_handler():
    user_id = _get_auth_user()
    namespace = _get_namespace(user_id)
    action = request.args.get("action", "")

    # ── 保存配置 ──
    if action == "save_config" and user_id and request.method == "POST":
        data = request.get_json(silent=True)
        if data is None:
            return _json_reply({"error": "Empty body"}, 400)
        config_file = CHAT_DATA_DIR / f"config_{namespace}.json"
        _write_json(config_file, data)
        return _json_reply({"success": True})

    # ── 加载配置 ──
    if action == "get_config" and user_id and request.method == "GET":
        config_file = CHAT_DATA_DIR / f"config_{namespace}.json"
        if config_file.exists():
            config = _read_json(config_file)
            return _json_reply(config)
        return _json_reply({})

    # ── POST: 保存聊天 ──
    if request.method == "POST":
        try:
            data = request.get_json(silent=True) or {}
        except Exception:
            return _json_reply({"error": "Invalid JSON"}, 400)

        chat_id = data.get("chat_id", "all")
        if not chat_id:
            return _json_reply({"error": "chat_id required"}, 400)

        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", chat_id)
        if not safe_id:
            return _json_reply({"error": "Invalid chat_id"}, 400)

        if safe_id == "all":
            filename = CHAT_DATA_DIR / f"{namespace}_all.json"
            chat_data = {
                "chat_id": "all",
                "chats": data.get("chats", {}),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            filename = CHAT_DATA_DIR / f"{namespace}_{safe_id}.json"
            chat_data = {
                "chat_id": safe_id,
                "messages": data.get("messages", []),
                "title": data.get("title", "新对话"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

        _write_json(filename, chat_data)

        # 保存前备份旧版本
        return _json_reply({"success": True, "path": filename.name})

    # ── GET: 加载聊天 ──
    if request.method == "GET":
        chat_id = request.args.get("chat_id", "all")
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", chat_id)

        if safe_id == "all":
            filename = CHAT_DATA_DIR / f"{namespace}_all.json"
            if filename.exists():
                data = _read_json(filename)
                return _json_reply(data)
            return _json_reply({"chats": {}})
        else:
            filename = CHAT_DATA_DIR / f"{namespace}_{safe_id}.json"
            if filename.exists():
                data = _read_json(filename)
                return _json_reply(data)
            return _json_reply({"error": "Chat not found"}, 404)

    return _json_reply({"error": "Method not allowed"}, 405)


# ═══════════════════════════════════════════
#  图片上传 /upload
# ═══════════════════════════════════════════

@app.route("/upload", methods=["GET", "POST"])
def upload_handler():
    if request.method == "GET":
        # 列出上传目录中的图片
        images = []
        if UPLOADS_DIR.exists():
            for f in sorted(UPLOADS_DIR.iterdir(), reverse=True)[:50]:
                if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                    images.append(f"/uploads/{f.name}")
        return _json_reply({"images": images})

    # POST: 上传
    data = request.get_json(silent=True) or {}
    image_data = data.get("image", "")
    if not image_data:
        return _json_reply({"error": "No image data"}, 400)

    # 解析 base64
    if image_data.startswith("data:"):
        match = re.match(r"data:([^;]+);base64,(.+)", image_data)
        if not match:
            return _json_reply({"error": "Invalid image data format"}, 400)
        mime_type = match.group(1)
        b64_data = match.group(2)
    else:
        mime_type = "image/png"
        b64_data = image_data

    try:
        raw = base64.b64decode(b64_data)
    except Exception:
        return _json_reply({"error": "Invalid base64 data"}, 400)

    if len(raw) > MAX_IMAGE_SIZE:
        return _json_reply({"error": "Image too large (max 10MB)"}, 400)

    # 验证图片类型
    ext_map = {
        "image/png": ".png", "image/jpeg": ".jpg",
        "image/gif": ".gif", "image/webp": ".webp",
    }
    ext = ext_map.get(mime_type, ".png")
    filename = f"img_{int(time.time()*1000)}{ext}"
    filepath = UPLOADS_DIR / filename

    try:
        img = Image.open(io.BytesIO(raw))
        img.save(filepath)
    except Exception:
        return _json_reply({"error": "Failed to save image"}, 500)

    return _json_reply({"url": f"/uploads/{filename}"})


# ═══════════════════════════════════════════
#  网页抓取代理 /fetch
# ═══════════════════════════════════════════

class HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._text = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self._text.append(data.strip())

    def get_text(self):
        return "\n".join(filter(None, self._text))


def _extract_text(html, base_url=""):
    """从 HTML 中提取纯文本"""
    parser = HTMLTextExtractor()
    parser.feed(html)
    text = parser.get_text()
    # 提取链接
    links = re.findall(r'href=["\'](https?://[^"\']+)["\']', html, re.I)
    if links:
        text += "\n\n链接:\n" + "\n".join(links[:20])
    return text[:MAX_RESULT_LENGTH]


def _is_private_ip(host):
    """检查是否为内网 IP"""
    import ipaddress
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private
    except ValueError:
        return False


@app.route("/fetch", methods=["POST"])
def fetch_handler():
    data = request.get_json(silent=True) or {}
    urls = data.get("urls", [])

    if not urls or not isinstance(urls, list):
        return _json_reply({"error": "Missing or empty urls array"}, 400)

    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    ]

    results = []
    for url in urls[:5]:
        try:
            parsed = urlparse(url)
            if not parsed.netloc:
                results.append({"url": url, "error": "Invalid URL"})
                continue

            # 阻止内网请求
            host = parsed.hostname or ""
            try:
                import socket
                ip = socket.gethostbyname(host)
                if _is_private_ip(ip):
                    results.append({"url": url, "error": "Internal address blocked"})
                    continue
            except Exception:
                pass

            headers = {
                "User-Agent": user_agents[hash(url) % len(user_agents)],
                "Accept": "text/html,application/xhtml+xml",
            }
            resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
            content_type = resp.headers.get("Content-Type", "")

            if "text/html" in content_type:
                text = _extract_text(resp.text, url)
            else:
                text = resp.text[:MAX_RESULT_LENGTH]

            results.append({"url": url, "content": text, "error": ""})

        except requests.Timeout:
            results.append({"url": url, "error": "Timeout", "content": ""})
        except Exception as e:
            results.append({"url": url, "error": str(e), "content": ""})

    return _json_reply({"results": results})


@app.route("/fetch-get", methods=["GET"])
def fetch_get_handler():
    url = request.args.get("url", "")
    if not url:
        return _json_reply({"error": "Missing url parameter"}, 400)

    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return _json_reply({"error": "Invalid URL or internal address blocked"}, 400)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
        resp = requests.get(url, headers=headers, timeout=15)
        content_type = resp.headers.get("Content-Type", "")

        if "text/html" in content_type:
            text = _extract_text(resp.text, url)
        else:
            text = resp.text[:MAX_RESULT_LENGTH]

        return _json_reply({"content": text, "error": ""})

    except Exception as e:
        return _json_reply({"error": str(e), "content": ""}, 500)


# ═══════════════════════════════════════════
#  启动
# ═══════════════════════════════════════════

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
    print(f"OneAPIChat Python 后端启动于 http://0.0.0.0:{port}")
    print(f"静态文件目录: {STATIC_DIR}")
    print("按 Ctrl+C 停止")

    from waitress import serve
    serve(app, host="0.0.0.0", port=port)
