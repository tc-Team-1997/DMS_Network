from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db import Base  # noqa: E402
from app import models  # noqa: F401,E402  (register models)
from app.services import tasks as _tasks  # noqa: F401,E402  (register TaskRun)
from app.config import settings  # noqa: E402

config = context.config
config.set_main_option("sqlalchemy.url", os.environ.get("DATABASE_URL", settings.DATABASE_URL))
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.", poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                          render_as_batch=connection.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
