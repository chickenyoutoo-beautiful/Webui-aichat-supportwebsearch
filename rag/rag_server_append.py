
app = FastAPI(title="OneAPIChat RAG v2")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

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
