import uuid
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from db.models import AuditLog


async def write_audit(
    actor: str,
    action: str,
    patient_id: str | None,
    data_type: str,
    db: AsyncSession,
) -> None:
    entry = AuditLog(
        id=str(uuid.uuid4()),
        actor=actor,
        action=action,
        patient_id=patient_id,
        data_type=data_type,
        timestamp=datetime.utcnow(),
    )
    db.add(entry)
    # No commit here — caller owns the transaction.
