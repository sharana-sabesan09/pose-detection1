from dataclasses import dataclass, field

import chromadb
from llama_index.core import VectorStoreIndex, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from config import settings

_index: VectorStoreIndex | None = None


@dataclass
class RagResult:
    context: str
    sources: list[str] = field(default_factory=list)
    hit_count: int = 0

    def __str__(self) -> str:
        return self.context


def _get_index() -> VectorStoreIndex | None:
    global _index
    if _index is None:
        embed_model = HuggingFaceEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
        Settings.embed_model = embed_model
        client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)
        try:
            collection = client.get_collection("clinical_guidelines")
        except ValueError:
            return None
        vector_store = ChromaVectorStore(chroma_collection=collection)
        _index = VectorStoreIndex.from_vector_store(vector_store)
    return _index


async def retrieve_clinical_context(query: str, top_k: int = 5) -> RagResult:
    index = _get_index()
    if index is None:
        return RagResult(context="No clinical guidelines available.", sources=[], hit_count=0)

    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(query)

    if not nodes:
        return RagResult(context="No relevant guidelines found.", sources=[], hit_count=0)

    context = "\n\n---\n\n".join(n.get_content() for n in nodes)
    sources = [
        n.metadata.get("file_name") or n.metadata.get("source") or "unknown"
        for n in nodes
    ]
    return RagResult(context=context, sources=sources, hit_count=len(nodes))
