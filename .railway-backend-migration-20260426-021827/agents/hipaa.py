import logging
from sqlalchemy.ext.asyncio import AsyncSession
from utils.phi_scanner import scan_and_redact
from utils.audit import write_audit

logger = logging.getLogger(__name__)


async def hipaa_wrap(
    content: str,
    actor: str,
    patient_id: str,
    data_type: str,
    db: AsyncSession,
) -> str:
    redacted, entity_types = scan_and_redact(content)
    if entity_types:
        logger.warning("PHI detected and redacted by %s — entities: %s", actor, entity_types)
    await write_audit(actor=actor, action="write_output", patient_id=patient_id, data_type=data_type, db=db)
    return redacted
