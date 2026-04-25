from openai import AsyncOpenAI
from config import settings

# General-purpose agents — OpenAI gpt-4o
openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY or "no-key")
OPENAI_MODEL = "gpt-4o"

# Exercise reporter — Gemini 2.0 Flash via OpenAI-compatible endpoint
gemini_client = AsyncOpenAI(
    api_key=settings.GEMINI_API_KEY or "no-key",
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)
GEMINI_MODEL = "gemini-2.0-flash"
