#!/usr/bin/env python3
"""
下载嵌入模型脚本
用法: python3 download_models.py
将通过代理 socks5://192.168.1.160:10808 下载 BGE 模型
"""
import os, sys, warnings
warnings.filterwarnings('ignore')

PROXY = 'socks5://192.168.1.160:10808'

# 设置环境变量代理
os.environ['HTTP_PROXY'] = PROXY
os.environ['HTTPS_PROXY'] = PROXY
os.environ['REQUESTS_CA_BUNDLE'] = ''

print("=" * 60)
print("RAG 嵌入模型下载工具")
print("=" * 60)

models = [
    ("BAAI/bge-small-zh-v1.5", "中文嵌入模型(推荐,512维,轻量)"),
    ("jinaai/jina-embeddings-v2-base-zh", "中文嵌入模型(Jina,768维)"),
]

for i, (model, desc) in enumerate(models):
    print(f"\n[{i+1}] {model} — {desc}")

choice = input("\n选择要下载的模型 (回车默认下载全部): ").strip()

to_download = models if choice == '' else [models[int(choice)-1]]

for model, desc in to_download:
    print(f"\n正在下载 {model} ...")
    print(f"代理: {PROXY}")
    sys.stdout.flush()
    
    try:
        from fastembed import TextEmbedding
        m = TextEmbedding(model_name=model, cache_dir="/tmp/fastembed_cache")
        print("模型加载成功!")
        
        # 测试
        emb = list(m.embed(["测试文本"]))
        print(f"嵌入维度: {len(emb[0])}")
        
        # 复制到持久化目录
        import shutil
        dest = f"/var/www/html/oneapichat/rag/embed_models/{model.replace('/', '--')}"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        print(f"模型已缓存到 /tmp/fastembed_cache")
        
    except KeyboardInterrupt:
        print("\n已取消")
        sys.exit(1)
    except Exception as e:
        print(f"下载失败: {e}")
        print("提示: 检查代理是否可用, 或直接复制 HuggingFace 缓存")

print("\n完成!")
