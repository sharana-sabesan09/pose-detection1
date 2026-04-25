from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from config import settings
from schemas.report import TokenRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer()

_ALGORITHM = "HS256"
_EXPIRE_HOURS = 24


def _create_token(data: dict) -> str:
    payload = {**data, "exp": datetime.utcnow() + timedelta(hours=_EXPIRE_HOURS)}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=_ALGORITHM)


def require_jwt(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@router.post("/token", response_model=TokenResponse)
async def get_token(body: TokenRequest):
    token = _create_token({"user_id": body.user_id, "role": body.role})
    return TokenResponse(access_token=token)
