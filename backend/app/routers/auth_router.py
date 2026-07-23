"""Login/logout endpoints. Kids never hit this -- public view is anonymous."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from .. import auth
from ..database import get_db
from ..models import User
from ..schemas import LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()

    # Same generic error whether the username doesn't exist or the PIN is wrong --
    # don't leak which one via the error message.
    generic_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or PIN")

    if not user:
        raise generic_error

    if auth.is_locked(user):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked until {user.locked_until.isoformat()} due to repeated failed attempts",
        )

    if not auth.verify_pin(payload.pin, user.pin_hash):
        auth.register_failed_attempt(db, user)
        raise generic_error

    auth.register_successful_login(db, user)
    token = auth.create_session_token(user.username, user.role)
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=auth.SESSION_HOURS * 3600,
    )
    return LoginResponse(role=user.role, username=user.username)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.get("/me", response_model=LoginResponse)
def me(user: User = Depends(auth.get_current_user)):
    return LoginResponse(role=user.role, username=user.username)
