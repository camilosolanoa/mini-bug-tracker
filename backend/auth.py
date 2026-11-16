"""A single configurable demo account, with a signed HttpOnly session cookie."""
import os
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


def require_user(request: Request) -> str:
    username = request.session.get("username")
    if not username:
        raise HTTPException(401, "Please sign in to continue.")
    return username


def auth_router() -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["Login"])
    username = os.environ.get("DEMO_USERNAME", "demo")
    password = os.environ.get("DEMO_PASSWORD", "bugtracker-demo")

    @router.get("/session")
    def session(request: Request):
        return {"username": request.session.get("username")}

    @router.post("/login")
    def login(credentials: Login, request: Request):
        correct_user = secrets.compare_digest(credentials.username.encode(), username.encode())
        correct_password = secrets.compare_digest(credentials.password.encode(), password.encode())
        if not (correct_user and correct_password):
            raise HTTPException(401, "Incorrect username or password.")
        request.session.clear()
        request.session["username"] = username
        return {"username": username}

    @router.post("/logout")
    def logout(request: Request):
        request.session.clear()
        return {"username": None}

    return router
