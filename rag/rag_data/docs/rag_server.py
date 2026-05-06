#!/usr/bin/env python3
"""
OneAPIChat RAG 个人知识库 (轻量版，无需外部模型下载)
"""

import os, json, re, math, hashlib, requests
from pathlib import Path
from datetime import datetime
from collections import Counter
import unicodedata

# === 配置 ===
RAG_DIR = Path(__file__).parent / "rag_data"
DOCS_DIR = RAG_DIR / "docs"
INDEX_FILE = RAG_DIR / "index.json"
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
print(f"[RAG] 索引文件: {INDEX_FILE}")

# === TF-IDF + 余弦相似度（无外部依赖）===
class SimpleRetriever:
    def __init__(self):
        self.index = self._load_index()
    
    def _load_index(self):
        if INDEX_FILE.exists():
            return json.loads(INDEX_FILE.read_text())
        return {"docs": [], "chunks": [], "tfidf": {}, "idf": {}, "vocab": []}
    
    def _save_index(self):
        INDEX_FILE.write_text(json.dumps(self.index, ensure_ascii=False, indent=2))
    
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
    
    def add_document(self, filepath):
        text = filepath.read_text("utf-8", errors="replace")
        source = filepath.name
        doc_id = hashlib.md5(str(filepath).encode()).hexdigest()[:12]
        
        # 分块
        chunks = self._split(text)
        
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
        self._save_index()
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

retriever = SimpleRetriever()

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

# === FastAPI Server ===
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="OneAPIChat RAG")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class Q(BaseModel):
    question: str
    top_k: int = TOP_K

@app.get("/health")
def health():
    return {"status": "ok", "documents": len(retriever.index["docs"])}

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    fp = DOCS_DIR / file.filename
    fp.write_bytes(await file.read())
    r = retriever.add_document(fp)
    return {"success": True, **r}

@app.get("/knowledge")
def list_docs():
    return {"documents": retriever.index["docs"], "total_chunks": len(retriever.index["chunks"])}

@app.post("/search")
def search(req: Q):
    hits = retriever.search(req.question, req.top_k)
    return {"question": req.question, "hits": hits, "total": len(hits)}

@app.post("/ask")
def ask(req: Q):
    hits = retriever.search(req.question, req.top_k)
    answer = answer_with_rag(req.question, hits)
    return {"question": req.question, "answer": answer, "sources": hits}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("RAG_PORT", "8765"))
    print(f"[RAG] 启动 http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
