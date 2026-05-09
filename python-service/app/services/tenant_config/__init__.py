# Re-export public API so callers can do:
#   from app.services.tenant_config import get, get_namespace, set as set_config
from .service import get, get_namespace, set  # noqa: F401
