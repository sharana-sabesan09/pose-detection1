from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str
    OPENAI_API_KEY: str
    JWT_SECRET: str
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    AGENTVERSE_MAILBOX_KEY: str = ""


settings = Settings()
