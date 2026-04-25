from openai import AsyncOpenAI
from config import settings

# Gemini via OpenAI-compatible endpoint — no new package required.
llm_client = AsyncOpenAI(
    api_key=settings.GEMINI_API_KEY or "no-key",
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

MODEL = "gemini-2.0-flash"
