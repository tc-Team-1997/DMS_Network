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

    # --- Multi-channel notifications (BRD #24) ---
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = ""
    SMTP_TLS: str = ""            # "ssl" for implicit TLS; empty → STARTTLS
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM: str = ""         # E.164 Twilio number for SMS
    TWILIO_WA_FROM: str = ""      # WhatsApp-enabled number, e.g. whatsapp:+14155238886


settings = Settings()
