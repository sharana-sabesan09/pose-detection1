from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str = "sqlite+aiosqlite:///./sentinel_dev.db"
    GEMINI_API_KEY: str = ""
    JWT_SECRET: str = "dev-secret-change-in-prod"
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    AGENTVERSE_MAILBOX_KEY: str = ""
    DEV_MODE: bool = True

    @field_validator("DATABASE_URL")
    @classmethod
    def fix_db_scheme(cls, v: str) -> str:
        # Railway (and most PaaS) emit postgres:// or postgresql:// — SQLAlchemy
        # async requires postgresql+asyncpg://
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v


settings = Settings()
