from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "NBE-DMS-Python-Service"
    APP_ENV: str = "dev"
    API_KEY: str = "change-me"
    JWT_SECRET: str = "change-me"
    DATABASE_URL: str = "sqlite:///./storage/dms.db"
    STORAGE_DIR: str = "./storage/documents"
    TESSERACT_CMD: str = ""
    POPPLER_PATH: str = ""

    CBS_BASE_URL: str = "http://mock-cbs.local/api"
    LOS_BASE_URL: str = "http://mock-los.local/api"
    AML_BASE_URL: str = "http://mock-aml.local/api"
    IFRS9_BASE_URL: str = "http://mock-ifrs9.local/api"


settings = Settings()
