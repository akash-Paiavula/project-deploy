import { useEffect, useState } from "react";

// Relative path - nginx/ALB ingress routes /api/* to the backend service.
const API_BASE = "/api";

export default function App() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadTodos() {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/todos`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setTodos(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTodos();
  }, []);

  async function addTodo(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await fetch(`${API_BASE}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      setTitle("");
      loadTodos();
    }
  }

  async function toggleDone(todo) {
    await fetch(`${API_BASE}/todos/${todo.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...todo, done: !todo.done }),
    });
    loadTodos();
  }

  async function removeTodo(id) {
    await fetch(`${API_BASE}/todos/${id}`, { method: "DELETE" });
    loadTodos();
  }

  return (
    <div className="page">
      <h1>Todo</h1>
      <p className="subtitle">React frontend + FastAPI backend, running on EKS.</p>

      <form className="add-row" onSubmit={addTodo}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
        />
        <button type="submit">Add</button>
      </form>

      {error && <p className="empty">Couldn't reach the API: {error}</p>}
      {!error && loading && <p className="empty">Loading…</p>}
      {!error && !loading && todos.length === 0 && (
        <p className="empty">No todos yet — add one above.</p>
      )}

      <ul className="todos">
        {todos.map((todo) => (
          <li key={todo.id} className={`todo ${todo.done ? "done" : ""}`}>
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggleDone(todo)}
            />
            <span>{todo.title}</span>
            <button className="delete" onClick={() => removeTodo(todo.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <p className="status">API base: {API_BASE}</p>
    </div>
  );
}
