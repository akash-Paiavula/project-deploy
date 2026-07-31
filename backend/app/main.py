import os
import uuid
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Todo API", version="1.0.0")

# CORS - in production, replace "*" with your actual frontend URL/domain
allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Todo(BaseModel):
    id: Optional[str] = None
    title: str
    done: bool = False


# In-memory store just for demo purposes.
# Swap this for a real database (RDS/Postgres, DynamoDB, etc.) in production.
DB: dict[str, Todo] = {}


@app.get("/api/health")
def health():
    """Used by the Kubernetes liveness/readiness probes."""
    return {"status": "ok"}


@app.get("/api/todos", response_model=List[Todo])
def list_todos():
    return list(DB.values())


@app.post("/api/todos", response_model=Todo, status_code=201)
def create_todo(todo: Todo):
    todo.id = str(uuid.uuid4())
    DB[todo.id] = todo
    return todo


@app.put("/api/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: str, todo: Todo):
    if todo_id not in DB:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo.id = todo_id
    DB[todo_id] = todo
    return todo


@app.delete("/api/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: str):
    if todo_id not in DB:
        raise HTTPException(status_code=404, detail="Todo not found")
    del DB[todo_id]
