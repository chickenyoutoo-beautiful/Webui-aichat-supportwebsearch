#!/usr/bin/env python3
"""
OneAPIChat RAG v2 — 混合检索（TF-IDF + 嵌入）
支持本地 fastembed / API 嵌入，可配置。
"""
import numpy as np
import os, json, re, math, hashlib, requests, shutil, time, sys, threading
sys.path.insert(0, '/tmp/pylib')

# ★ 尝试导入 fastembed（本地嵌入）
_has_fastembed = False
try:
    import warnings
    warnings.filterwarnings('ignore')
    from fastembed import TextEmbedding as FastTextEmbedding
    _has_fastembed = True
    print(f"[RAG] fastembed 可用 ({FastTextEmbedding.list_supported_models()[0]['model']} 等)")
except Exception as e:
    print(f"[RAG] fastembed 不可用 ({e}), 将使用 API 嵌入")
from pathlib import Path
from datetime import datetime
from collections import Counter
from base64 import b64decode

# === 配置 ===
RAG_DIR = Path(__file__).parent / "rag_data"
DOCS_DIR = RAG_DIR / "docs"
for d in [RAG_DIR, DOCS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

LLM_BASE_URL = os.getenv("RAG_LLM_URL", "https://api.deepseek.com")
LLM_API_KEY = os.getenv("RAG_LLM_KEY", "")
LLM_MODEL = os.getenv("RAG_LLM_MODEL", "deepseek-chat")
TOP_K = int(os.getenv("RAG_TOP_K", "5"))
EMBED_BATCH = 10                       # 每次嵌入批处理数

# 自动解密 oneapichat 的 API Key
if not LLM_API_KEY:
    config_dir = Path("/var/www/html/oneapichat/chat_data")
    if config_dir.exists():
        configs = sorted(config_dir.glob("config_*.json"))
        if configs:
            try:
                cfg = json.loads(configs[-1].read_text())
                enc = cfg.get("apiKey", "")
                if enc and enc.startswith("HQ"):
                    key = b"naujtrats-secret"
                    raw = b64decode(enc)
                    dec = bytearray()
                    for i, b in enumerate(raw):
                        dec.append(b ^ key[i % len(key)])
                    LLM_API_KEY = dec.decode()
            except Exception:
                pass

print(f"[RAG] LLM: {LLM_MODEL} | 数据目录: {RAG_DIR}")

_rag_write_lock = threading.Lock()
_retriever_cache_lock = threading.Lock()
_retriever_cache = {}

DEFAULT_COLLECTION = "default"
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB 最大上传

# ========== 嵌入客户端 ==========
class EmbeddingClient:
    def __init__(self, base_url="", api_key="", model="", cache_dir="/tmp/fastembed_cache"):
        self.base_url = base_url or LLM_BASE_URL
        self.api_key = api_key or LLM_API_KEY
        self.model = model
        self._cache = {}
        self._local_model = None
        # 如果是本地 fastembed 模型名，初始化本地模型
        if model and _has_fastembed and not model.startswith("text-embedding-") and not model.startswith("bge-m3"):
            try:
                self._local_model = FastTextEmbedding(
                    model_name=model,
                    cache_dir=cache_dir
                )
                print(f"[Embed] 本地模型已加载: {model}")
            except Exception as e:
                print(f"[Embed] 本地模型加载失败: {e}")
                self._local_model = None

    def embed(self, texts):
        if not texts:
            return []
        
        # ★ 本地 fastembed 优先
        if self._local_model:
            try:
                return [list(v) for v in self._local_model.embed(texts)]
            except Exception as e:
                print(f"[Embed] local failed: {e}")
                return None
        
        # ★ API 嵌入
        if not self.model:
            return None
        results = []
        batch = []
        for t in texts:
            key = hashlib.md5(t.encode()).hexdigest()
            if key in self._cache:
                results.append(self._cache[key])
            else:
                batch.append((key, t))
        if batch:
            try:
                resp = requests.post(
                    f"{self.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={"model": self.model, "input": [t for _, t in batch]},
                    timeout=30
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for i, (key, _) in enumerate(batch):
                        vec = data["data"][i]["embedding"]
                        self._cache[key] = vec
                        results.insert(len(results), vec)
                else:
                    print(f"[Embed] API error {resp.status_code}")
                    return None
            except Exception as e:
                print(f"[Embed] API failed: {e}")
                return None
        return results
    
    @staticmethod
    def cosine_similarity(a, b):
        if not a or not b or len(a) != len(b):
            return 0
        dot = sum(ai * bi for ai, bi in zip(a, b))
        na = math.sqrt(sum(ai * ai for ai in a))
        nb = math.sqrt(sum(bi * bi for bi in b))
        return dot / (na * nb) if na and nb else 0
    
    @staticmethod
    def list_local_models():
        """列出可用的本地嵌入模型"""
        if not _has_fastembed:
            return []
        try:
            models = FastTextEmbedding.list_supported_models()
            return [{
                "model": m["model"],
                "dim": m.get("dim", 0),
                "desc": m.get("description", "")
            } for m in models]
        except:
            return []


# ========== 词法分析 + TF-IDF ==========
class Tokenizer:
    @staticmethod
    def tokenize(text):
        text = text.lower()
        tokens = []
        i = 0
        while i < len(text):
            ch = text[i]
            if '\u4e00' <= ch <= '\u9fff' or '\u3000' <= ch <= '\u303f':
                tokens.append(ch)
                i += 1
            elif ch.isascii() and ch.isalnum():
                j = i
                while j < len(text) and text[j].isascii() and (text[j].isalnum() or text[j] in "_-"):
                    j += 1
                tokens.append(text[i:j])
                i = j
            else:
                i += 1
        return [t for t in tokens if len(t) > 0]


# ========== 索引管理器 ==========
def _collection_index_file(name):
    return RAG_DIR / f"{name}_index.json"

def _collection_docs_dir(name):
    d = RAG_DIR / f"docs_{name}"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _collection_config_file(name):
    return RAG_DIR / f"{name}_config.json"

def _get_index(collection):
    f = _collection_index_file(collection)
    if f.exists():
        return json.loads(f.read_text())
    return {"docs": [], "chunks": [], "tfidf": {}, "idf": {}, "vocab": [], "embeddings": {}}

class _NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        import numpy as np
        if isinstance(o, (np.float16, np.float32, np.float64)):
            return float(o)
        if isinstance(o, (np.int8, np.int16, np.int32, np.int64)):
            return int(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)

def _save_index(collection, index):
    _collection_index_file(collection).write_text(json.dumps(index, ensure_ascii=False, indent=2, cls=_NumpyEncoder))

def _get_config(collection):
    f = _collection_config_file(collection)
    if f.exists():
        return json.loads(f.read_text())
    return {"embed_model": "", "embed_base_url": "", "mode": "hybrid"}

def _save_config(collection, config):
    _collection_config_file(collection).write_text(json.dumps(config, ensure_ascii=False, indent=2))

def _list_collections():
    names = {DEFAULT_COLLECTION}
    for f in RAG_DIR.glob("*_index.json"):
        name = f.stem.replace("_index", "")
        if name:
            names.add(name)
    return sorted(names)


# ========== 文档分块 ==========
def split_document(text):
    """智能分块：按标题 → 段落，每块 200~800 字符"""
    # 按 Markdown 标题分
    sections = re.split(r'(^#+ .+$)', text, flags=re.MULTILINE)
    raw_chunks = []
    buf = ""
    for part in sections:
        if re.match(r'^#+ ', part):
            if buf.strip():
                raw_chunks.append(buf.strip())
            buf = part + "\n"
        else:
            buf += part
    if buf.strip():
        raw_chunks.append(buf.strip())

    # 再按段落分
    result = []
    for chunk in raw_chunks:
        if len(chunk) <= 800:
            result.append(chunk)
        else:
            # 按段落切
            paras = [p.strip() for p in chunk.split("\n\n") if p.strip()]
            for para in paras:
                if len(para) > 800:
                    # 长段落按句号切
                    sents = re.split(r'(?<=[。！？\n])', para)
                    buf = ""
                    for s in sents:
                        if not s.strip():
                            continue
                        if len(buf) + len(s) <= 500:
                            buf += s
                        else:
                            if buf.strip():
                                result.append(buf.strip())
                            buf = s
                    if buf.strip():
                        result.append(buf.strip())
                else:
                    result.append(para)
    return [c for c in result if len(c) > 10]


# ========== 检索器 ==========
class CollectionRetriever:
    def __init__(self, collection=DEFAULT_COLLECTION):
        self.collection = collection
        self.reload()

    def reload(self):
        self.index = _get_index(self.collection)
        self.config = _get_config(self.collection)

    def _cosine_tfidf(self, q_tokens, d_tf):
        """TF-IDF 余弦相似度"""
        idf = self.index.get("idf", {})
        dot = q_norm = d_norm = 0
        for term, qv in q_tokens.items():
            w = qv * idf.get(term, 1)
            q_norm += w * w
            if term in d_tf:
                dw = d_tf[term] * idf.get(term, 1)
                dot += w * dw
        for term, dv in d_tf.items():
            dw = dv * idf.get(term, 1)
            d_norm += dw * dw
        return dot / (math.sqrt(q_norm) * math.sqrt(d_norm)) if q_norm and d_norm else 0

    def add_document(self, filepath, summary_text=None):
        with _rag_write_lock:
            return self._add_document_locked(filepath, summary_text)
    
    def _add_document_locked(self, filepath, summary_text=None):
        # 持有锁时重新加载索引（可能被并发修改过）
        self.reload()
        # 对 PDF 使用 pdftotext 提取文字
        if filepath.suffix.lower() == ".pdf":
            import subprocess
            try:
                result = subprocess.run(["pdftotext", "-layout", str(filepath), "-"], capture_output=True, text=True, timeout=30)
                text = result.stdout
            except Exception as e:
                print(f"[RAG] PDF提取失败: {e}, 回退到原始读取")
                text = filepath.read_text("utf-8", errors="replace")
        else:
            # 自动检测文本编码
            raw_bytes = filepath.read_bytes()
            try:
                import chardet
                detected = chardet.detect(raw_bytes)
                enc = detected.get("encoding", "utf-8") or "utf-8"
                # chardet 可能返回不带 - 的编码名
                if enc.lower() in ("gb2312", "gbk"):
                    enc = "gb18030"
                text = raw_bytes.decode(enc, errors="replace")
            except ImportError:
                # chardet 不可用，尝试常见中文编码
                for enc in ["utf-8", "gb18030", "gbk", "gb2312"]:
                    try:
                        text = raw_bytes.decode(enc)
                        break
                    except:
                        continue
                else:
                    text = filepath.read_text("utf-8", errors="replace")
        source = filepath.name
        doc_id = hashlib.md5(str(filepath).encode()).hexdigest()[:12]
        chunks = split_document(text)

        if summary_text and summary_text.strip():
            chunks.append(f"[摘要] {summary_text.strip()}")

        doc_entry = {"id": doc_id, "source": source, "chunks": len(chunks),
                      "added": datetime.now().isoformat()}
        self.index["docs"].append(doc_entry)

        chunk_entries = []
        all_tokens = []
        chunk_texts = []
        for i, chunk in enumerate(chunks):
            tokens = Tokenizer.tokenize(chunk)
            all_tokens.extend(tokens)
            tf = Counter(tokens)
            chunk_entries.append({
                "id": f"{doc_id}_{i}", "text": chunk, "source": source,
                "tokens": tokens, "tf": dict(tf)
            })
            chunk_texts.append(chunk)

        self.index["chunks"].extend(chunk_entries)

        # 重新计算 IDF
        n_docs = len(self.index["chunks"])
        all_terms = set()
        for ce in self.index["chunks"]:
            all_terms.update(ce["tf"].keys())
        idf = {}
        for term in all_terms:
            df = sum(1 for ce in self.index["chunks"] if term in ce["tf"])
            idf[term] = math.log((n_docs + 1) / (df + 1)) + 1
        self.index["idf"] = idf

        # ★ 嵌入生成已移到前端显式调用，此处不再自动生成

        _save_index(self.collection, self.index)
        return {"doc_id": doc_id, "chunks": len(chunks), "source": source}

    def search(self, question, top_k=TOP_K):
        if not self.index["chunks"]:
            return []

        # TF-IDF 得分
        q_tokens = Counter(Tokenizer.tokenize(question))
        tfidf_scores = []
        for chunk in self.index["chunks"]:
            score = self._cosine_tfidf(q_tokens, chunk["tf"])
            if score > 0:
                tfidf_scores.append((score, chunk))

        # 嵌入得分（仅当已有嵌入向量时计算）
        embed_scores = {}
        if self.index.get("embeddings"):
            try:
                ec = get_embed_client(self.config.get("embed_model", ""), self.config.get("embed_base_url", ""))
                if ec and ec.model:
                    q_emb = ec.embed([question])
                    if q_emb and q_emb[0]:
                        q_vec = q_emb[0][:128]
                        for chunk in self.index["chunks"]:
                            cid = chunk["id"]
                            if cid in self.index["embeddings"]:
                                score = EmbeddingClient.cosine_similarity(q_vec, self.index["embeddings"][cid])
                                embed_scores[cid] = float(score)
            except Exception as e:
                print(f"[RAG] 嵌入评分失败: {e}")

        # 混合评分：TF-IDF 和嵌入各贡献 50%
        mode = self.config.get("mode", "hybrid")
        scored = {}
        for score, chunk in tfidf_scores:
            cid = chunk["id"]
            if mode == "embedding" and cid in embed_scores:
                scored[cid] = (scored.get(cid, 0) + embed_scores[cid])
            elif mode == "tfidf":
                scored[cid] = score
            else:  # hybrid
                emb = embed_scores.get(cid, 0)
                scored[cid] = score * 0.5 + emb * 0.5

        # 如果没有 TF-IDF 结果但有嵌入结果
        if not scored and embed_scores:
            scored = embed_scores

        ranked = sorted(scored.items(), key=lambda x: -x[1])
        chunks_map = {c["id"]: c for c in self.index["chunks"]}

        results = []
        for cid, score in ranked[:top_k]:
            chunk = chunks_map.get(cid)
            if not chunk:
                continue
            results.append({
                "content": chunk["text"][:300],
                "full_content": chunk["text"],
                "source": chunk["source"],
                "score": float(round(score, 4))
            })
        return results


# ========== FastAPI Server ==========
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Query, Request
from fastapi.middleware.cors import CORSMiddleware

class Q(BaseModel):
    question: str
    top_k: int = TOP_K

app = FastAPI(title="OneAPIChat RAG v2")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

_retriever_cache = {}
_retriever_cache_lock = threading.Lock()

def get_retriever(collection):
    """获取/创建检索器（缓存）"""
    coll = collection or DEFAULT_COLLECTION
    with _retriever_cache_lock:
        if coll not in _retriever_cache:
            _retriever_cache[coll] = CollectionRetriever(coll)
        return _retriever_cache[coll]

_embed_client_cache = None
_embed_client_cache_lock = threading.Lock()
_embed_client_cache_model = ""

def get_embed_client(embed_model="", embed_base_url=""):
    """全局缓存嵌入客户端"""
    global _embed_client_cache, _embed_client_cache_model
    with _embed_client_cache_lock:
        if embed_model != _embed_client_cache_model or _embed_client_cache is None:
            _embed_client_cache = EmbeddingClient(
                base_url=embed_base_url or LLM_BASE_URL,
                api_key=LLM_API_KEY,
                model=embed_model
            )
            _embed_client_cache_model = embed_model
        return _embed_client_cache

@app.get("/health")
def health(collection: str = Query(DEFAULT_COLLECTION)):
    r = get_retriever(collection)
    cfg = _get_config(collection)
    return {
        "status": "ok",
        "documents": len(r.index["docs"]),
        "chunks": len(r.index["chunks"]),
        "embeddings": len(r.index.get("embeddings", {})),
        "embed_model": cfg.get("embed_model", ""),
        "mode": cfg.get("mode", "hybrid"),
        "local_models": _has_fastembed,
        "collection": collection
    }

@app.get("/embed_config")
@app.post("/embed_config")
def handle_embed_config(collection: str = Query(DEFAULT_COLLECTION),
                        embed_model: str = Query(""),
                        embed_base_url: str = Query(""),
                        mode: str = Query("hybrid")):
    if embed_model:
        cfg = _get_config(collection)
        cfg["embed_model"] = embed_model
        cfg["embed_base_url"] = embed_base_url
        cfg["mode"] = mode
        _save_config(collection, cfg)
        r = get_retriever(collection)
        texts = [c["text"] for c in r.index["chunks"]]
        if texts:
            ec = get_embed_client(embed_model, embed_base_url)
            embs = ec.embed(texts)
            if embs:
                for i, vec in enumerate(embs):
                    if "embeddings" not in r.index:
                        r.index["embeddings"] = {}
                    r.index["embeddings"][r.index["chunks"][i]["id"]] = vec[:128]
                _save_index(collection, r.index)
                return {"success": True, "embedded": len(embs), "mode": mode}
        return {"success": True, "embedded": 0, "mode": mode}
    return _get_config(collection)

@app.post("/upload")
async def upload(file: UploadFile = File(...), collection: str = Query(DEFAULT_COLLECTION), mode: str = Query("tfidf")):
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        return {"success": False, "error": f"文件过大 (最大{MAX_UPLOAD_SIZE//1024//1024}MB)，当前{len(content)/1024/1024:.1f}MB"}
    r = get_retriever(collection)
    docs_dir = _collection_docs_dir(collection)
    fp = docs_dir / file.filename
    fp.write_bytes(content)
    result = r.add_document(fp)
    result["mode"] = mode
    return {"success": True, **result}

@app.get("/knowledge")
def list_docs(collection: str = Query(DEFAULT_COLLECTION)):
    r = get_retriever(collection)
    return {"documents": r.index["docs"], "total_chunks": len(r.index["chunks"]), "collection": collection}

@app.post("/search")
def search(req: Q, collection: str = Query(DEFAULT_COLLECTION)):
    r = get_retriever(collection)
    hits = r.search(req.question, req.top_k)
    return {"question": req.question, "hits": hits, "total": len(hits), "collection": collection}

@app.post("/ask")
def ask(req: Q, collection: str = Query(DEFAULT_COLLECTION)):
    r = get_retriever(collection)
    hits = r.search(req.question, req.top_k)
    if not hits:
        return {"question": req.question, "answer": "知识库中没有找到相关内容。", "sources": [], "collection": collection}
    context = "\n---\n".join([f"[{h['source']}] {h['full_content']}" for h in hits])
    answer = f"基于以下参考内容回答问题：\n\n{context}\n\n问题：{req.question}"
    try:
        resp = requests.post(f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json={"model": LLM_MODEL, "messages": [{"role": "user", "content": answer}],
                  "temperature": 0.3, "max_tokens": 2048}, timeout=60)
        resp.raise_for_status()
        answer = resp.json()["choices"][0]["message"]["content"]
        sources = list(dict.fromkeys(h["source"] for h in hits))
        answer += f"\n\n📚 来源：{', '.join(sources)}"
    except Exception as e:
        answer = f"生成回答时出错：{e}"
    return {"question": req.question, "answer": answer, "sources": hits, "collection": collection}

@app.get("/list_models")
def list_embed_models():
    models = EmbeddingClient.list_local_models()
    return {"models": models, "local_available": _has_fastembed}

@app.get("/collections")
def list_collections():
    return {"collections": list(_list_collections())}

@app.get("/create_collection")
@app.post("/create_collection")
def create_collection(name: str = Query(...)):
    if _collection_index_file(name).exists():
        return {"success": False, "error": "已存在"}
    _save_index(name, {"docs": [], "chunks": [], "tfidf": {}, "idf": {}, "vocab": [], "embeddings": {}})
    return {"success": True, "collection": name}

@app.delete("/delete_document")
@app.get("/delete_document")
def delete_document(doc_id: str = Query(...), collection: str = Query(DEFAULT_COLLECTION)):
    r = get_retriever(collection)
    removed = False
    removed_chunks = 0
    for i, d in enumerate(r.index["docs"]):
        if d["id"] == doc_id:
            removed_chunks = d["chunks"]
            r.index["docs"].pop(i)
            removed = True
            break
    if removed:
        keys_to_remove = [k for k in r.index.get("embeddings", {}) if k.startswith(doc_id + "_")]
        for k in keys_to_remove:
            del r.index["embeddings"][k]
        r.index["chunks"] = [c for c in r.index["chunks"] if not c["id"].startswith(doc_id + "_")]
        _save_index(collection, r.index)
    return {"success": True, "removed_chunks": removed_chunks, "remaining_docs": len(r.index["docs"])}

@app.delete("/delete_collection")
@app.get("/delete_collection")
def delete_collection(name: str = Query(...)):
    if not name or name == DEFAULT_COLLECTION:
        return {"success": False, "error": "不能删除默认知识库"}
    for f in [_collection_index_file(name), _collection_config_file(name)]:
        if f.exists(): f.unlink()
    d = _collection_docs_dir(name)
    if d.exists(): shutil.rmtree(str(d))
    return {"success": True, "collection": name}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("RAG_PORT", "8765"))
    print(f"[RAG v2] 启动 http://0.0.0.0:{port}")
    print(f"[RAG v2] 嵌入模式: 配置后可启用")
    uvicorn.run(app, host="0.0.0.0", port=port)
