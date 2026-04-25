import chromadb
from llama_index.core import VectorStoreIndex, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from config import settings

_index: VectorStoreIndex | None = None


def _get_index() -> VectorStoreIndex:
    global _index
    if _index is None:
        embed_model = HuggingFaceEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
        Settings.embed_model = embed_model

        client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)
        collection = client.get_collection("clinical_guidelines")
        vector_store = ChromaVectorStore(chroma_collection=collection)
        _index = VectorStoreIndex.from_vector_store(vector_store)
    return _index


async def retrieve_clinical_context(query: str, top_k: int = 5) -> str:
    index = _get_index()
    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(query)
    return "\n\n---\n\n".join(n.get_content() for n in nodes)
