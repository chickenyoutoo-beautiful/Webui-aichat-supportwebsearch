#!/usr/bin/env python3
"""
OneAPIChat RAG 个人知识库 (轻量版，支持多知识库 + AI摘要模式)
"""

import os, json, re, math, hashlib, requests, shutil
from pathlib import Path
from datetime import datetime
from collections import Counter
import unicodedata

# === 配置 ===
RAG_DIR = Path(__file__).parent / "rag_data"
DOCS_DIR = RAG_DIR / "docs"
for d in [RAG_DIR, DOCS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

LLM_BASE_URL = os.getenv("RAG_LLM_URL", "https://api.deepseek.com")
LLM_API_KEY = os.getenv("RAG_LLM_KEY", "")
LLM_MODEL = os.getenv("RAG_LLM_MODEL", "deepseek-chat")
TOP_K = int(os.getenv("RAG_TOP_K", "5"))

# Auto-detect API key from oneapichat config
if not LLM_API_KEY:
    import base64
    config_dir = Path("/var/www/html/oneapichat/chat_data")
    if config_dir.exists():
        configs = sorted(config_dir.glob("config_*.json"))
        if configs:
            try:
                cfg = json.loads(configs[-1].read_text())
                enc = cfg.get("apiKey", "")
                if enc and enc.startswith("HQ"):
                    key = b"naujtrats-secret"
                    raw = base64.b64decode(enc)
                    dec = bytearray()
                    for i, b in enumerate(raw):
                        dec.append(b ^ key[i % len(key)])
                    LLM_API_KEY = dec.decode()
                    print(f"[RAG] 已自动解密API Key: {LLM_API_KEY[:8]}...")
            except: pass

print(f"[RAG] LLM: {LLM_MODEL}")
print(f"[RAG] 数据目录: {RAG_DIR}")

# === 多知识库管理器 ===
DEFAULT_COLLECTION = "default"

def _collection_index_file(name):
    return RAG_DIR / f"{name}_index.json"

def _collection_docs_dir(name):
    d = RAG_DIR / f"docs_{name}"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _get_index(collection):
    """获取指定知识库的索引"""
    f = _collection_index_file(collection)
    if f.exists():
        return json.loads(f.read_text())
    return {"docs": [], "chunks": [], "tfidf": {}, "idf": {}, "vocab": []}

def _save_index(collection, index):
    _collection_index_file(collection).write_text(
        json.dumps(index, ensure_ascii=False, indent=2)
    )

def _list_collections():
    """列出所有知识库"""
    names = set()
    names.add(DEFAULT_COLLECTION)
    for f in RAG_DIR.glob("*_index.json"):
        name = f.stem.replace("_index", "")
        if name:
            names.add(name)
    return sorted(names)

# === TF-IDF + 余弦相似度（无外部依赖）===
class CollectionRetriever:
    def __init__(self, collection=DEFAULT_COLLECTION):
        self.collection = collection
        self.index = _get_index(collection)
    
    def reload(self):
        self.index = _get_index(self.collection)
    
    def _tokenize(self, text):
        """分词：中文逐字 + 英文按词"""
        text = text.lower()
        tokens = []
        i = 0
        while i < len(text):
            ch = text[i]
            # CJK 字符：逐个添加
            if '\u4e00' <= ch <= '\u9fff' or '\u3000' <= ch <= '\u303f':
                tokens.append(ch)
                i += 1
            # ASCII 字母数字：按连续单词切
            elif ch.isascii() and ch.isalnum():
                j = i
                while j < len(text) and text[j].isascii() and (text[j].isalnum() or text[j] in "_-"):
                    j += 1
                tokens.append(text[i:j])
                i = j
            else:
                i += 1
        return [t for t in tokens if len(t) > 0]
    
    def add_document(self, filepath, summary_text=None):
        """添加文档，支持可选的摘要文本"""
        text = filepath.read_text("utf-8", errors="replace")
        source = filepath.name
        doc_id = hashlib.md5(str(filepath).encode()).hexdigest()[:12]
        
        # 分块
        chunks = self._split(text)
        
        # 如果提供了摘要，将摘要也作为一个独立chunk加入（提升检索效果）
        if summary_text and summary_text.strip():
            chunks.append(f"[摘要] {summary_text.strip()}")
        
        # 更新索引
        doc_entry = {"id": doc_id, "source": source, "chunks": len(chunks), "added": datetime.now().isoformat()}
        self.index["docs"].append(doc_entry)
        
        chunk_entries = []
        all_tokens = []
        for i, chunk in enumerate(chunks):
            tokens = self._tokenize(chunk)
            all_tokens.extend(tokens)
            tf = Counter(tokens)
            chunk_entries.append({
                "id": f"{doc_id}_{i}",
                "text": chunk,
                "source": source,
                "tokens": tokens,
                "tf": dict(tf)
            })
        
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
        _save_index(self.collection, self.index)
        return {"doc_id": doc_id, "chunks": len(chunks), "source": source}
    
    def _split(self, text):
        """TF-IDF分块"""
        chunks = []
        sections = re.split(r'(^#+ .+$)', text, flags=re.MULTILINE)
        buf = ""
        for part in sections:
            if re.match(r'^#+ ', part):
                if buf.strip(): chunks.append(buf.strip())
                buf = part + "\n"
            else:
                buf += part
        if buf.strip(): chunks.append(buf.strip())
        
        result = []
        for chunk in chunks:
            if len(chunk) <= 500:
                result.append(chunk)
            else:
                for para in chunk.split("\n\n"):
                    p = para.strip()
                    if not p: continue
                    if len(p) > 500:
                        for i in range(0, len(p), 500):
                            result.append(p[i:i+500].strip())
                    else:
                        result.append(p)
        return [c for c in result if len(c) > 10]
    
    def search(self, question, top_k=TOP_K):
        """TF-IDF 余弦相似度检索"""
        if not self.index["chunks"]:
            return []
        
        q_tokens = Counter(self._tokenize(question))
        idf = self.index["idf"]
        
        def cosine_sim(q_tf, d_tf):
            dot = 0
            q_norm = 0
            d_norm = 0
            for term, qv in q_tf.items():
                w = qv * idf.get(term, 1)
                q_norm += w * w
                if term in d_tf:
                    dw = d_tf[term] * idf.get(term, 1)
                    dot += w * dw
            for term, dv in d_tf.items():
                dw = dv * idf.get(term, 1)
                d_norm += dw * dw
            
            if q_norm == 0 or d_norm == 0:
                return 0
            return dot / (math.sqrt(q_norm) * math.sqrt(d_norm))
        
        scored = []
        for chunk in self.index["chunks"]:
            score = cosine_sim(dict(q_tokens), chunk["tf"])
            if score > 0:
                scored.append((score, chunk))
        
        scored.sort(reverse=True)
        results = []
        for score, chunk in scored[:top_k]:
            results.append({
                "content": chunk["text"][:300],
                "full_content": chunk["text"],
                "source": chunk["source"],
                "score": round(score, 4)
            })
        return results


def get_retriever(collection=DEFAULT_COLLECTION):
    return CollectionRetriever(collection)


def answer_with_rag(question, hits):
    if not hits:
        return "知识库中没有找到相关内容。"
    context = "\n---\n".join([f"[{h['source']}] {h['full_content']}" for h in hits])
    resp = requests.post(f"{LLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
        json={"model": LLM_MODEL, "messages": [{"role": "user", "content":
            f"基于以下参考内容回答问题：\n\n{context}\n\n问题：{question}"}],
            "temperature": 0.3, "max_tokens": 2048}, timeout=60)
    resp.raise_for_status()
    answer = resp.json()["choices"][0]["message"]["content"]
    sources = list(dict.fromkeys(h["source"] for h in hits))
    return answer + f"\n\n📚 来源：{', '.join(sources)}"


def generate_summary(text, filename):
    """使用LLM生成文档摘要"""
    sample = text[:3000]  # 取前3000字符
    try:
        resp = requests.post(f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json={"model": LLM_MODEL, "messages": [{"role": "user", "content":
                f"请为以下文档生成一段简洁的中文摘要（50-100字），重点概括核心内容：\n\n文件名：{filename}\n\n文档内容：\n{sample}"}],
                "temperature": 0.3, "max_tokens": 300}, timeout=30)
        resp.raise_for_status()
        summary = resp.json()["choices"][0]["message"]["content"].strip()
        # 清理可能的引号
        summary = summary.strip('"').strip("'").strip('「」').strip()
        return summary
    except Exception as e:
        print(f"[RAG] 摘要生成失败: {e}")
        return None


# === FastAPI Server ===
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="OneAPIChat RAG")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class Q(BaseModel):
    question: str
    top_k: int = TOP_K


def get_retriever_for_collection(collection: str):
    c = collection or DEFAULT_COLLECTION
    return get_retriever(c)


@app.get("/health")
def health(collection: str = Query(DEFAULT_COLLECTION)):
    r = get_retriever(collection)
    return {"status": "ok", "documents": len(r.index["docs"]), "collection": collection}

@app.post("/upload")
async def upload(file: UploadFile = File(...), collection: str = Query(DEFAULT_COLLECTION), mode: str = Query("tfidf")):
    r = get_retriever(collection)
    docs_dir = _collection_docs_dir(collection)
    fp = docs_dir / file.filename
    fp.write_bytes(await file.read())
    
    # AI摘要模式：先生成摘要再索引
    summary = None
    if mode == "summary":
        text = fp.read_text("utf-8", errors="replace")
        summary = generate_summary(text, file.filename)
        print(f"[RAG] 摘要模式: {file.filename} -> {summary}")
    
    result = r.add_document(fp, summary_text=summary)
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
    answer = answer_with_rag(req.question, hits)
    return {"question": req.question, "answer": answer, "sources": hits, "collection": collection}

@app.get("/collections")
def list_collections():
    cols = _list_collections()
    return {"collections": cols}

@app.post("/create_collection")
def create_collection(name: str = Query(...), collection: str = Query(DEFAULT_COLLECTION)):
    """创建新的知识库（只需创建索引文件）"""
    if not name or not re.match(r'^[a-zA-Z0-9_\-\u4e00-\u9fff]+$', name):
        return {"success": False, "error": "无效的知识库名称"}
    f = _collection_index_file(name)
    if f.exists():
        return {"success": False, "error": "知识库已存在"}
    default_index = {"docs": [], "chunks": [], "tfidf": {}, "idf": {}, "vocab": []}
    _save_index(name, default_index)
    # 同时创建文档目录
    _collection_docs_dir(name)
    return {"success": True, "collection": name}

@app.delete("/delete_collection")
@app.get("/delete_collection")
def delete_collection(name: str = Query(...)):
    """删除知识库（删除索引文件和文档目录）"""
    if not name or name == DEFAULT_COLLECTION:
        return {"success": False, "error": "不能删除默认知识库"}
    f = _collection_index_file(name)
    docs_dir = _collection_docs_dir(name)
    
    deleted = False
    if f.exists():
        f.unlink()
        deleted = True
    if docs_dir.exists():
        shutil.rmtree(str(docs_dir))
        deleted = True
    
    if deleted:
        return {"success": True, "collection": name}
    else:
        return {"success": False, "error": "知识库不存在"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("RAG_PORT", "8765"))
    print(f"[RAG] 启动 http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
