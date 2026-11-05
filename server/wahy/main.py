"""Builds the FastAPI app. Each feature mounts its own router here (see docs/rewrite/ARCHITECTURE.md)."""

from fastapi import FastAPI

app = FastAPI(title="Wahy-Finder", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
