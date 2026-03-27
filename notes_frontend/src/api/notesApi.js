import { NOTES_API_BASE_URL } from "../config";

/**
 * Build a full API URL from a path, supporting empty base URL for same-origin setups.
 */
function url(path) {
  if (!NOTES_API_BASE_URL) return path;
  return `${NOTES_API_BASE_URL}${path}`;
}

async function request(path, options = {}) {
  const res = await fetch(url(path), {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      // ignore parse errors
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }

  // DELETE returns json in our API; keep generic.
  return res.json();
}

// PUBLIC_INTERFACE
export async function listNotes({ q, tag, limit = 50, offset = 0 }) {
  /** List notes with optional search and tag filter. */
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request(`/notes?${params.toString()}`, { method: "GET" });
}

// PUBLIC_INTERFACE
export async function createNote({ title, content, tags }) {
  /** Create a note. */
  return request("/notes", {
    method: "POST",
    body: JSON.stringify({ title, content, tags: tags || [] }),
  });
}

// PUBLIC_INTERFACE
export async function updateNote(id, { title, content, tags, pinned }) {
  /** Patch update a note. Provide tags to replace existing tags. */
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (content !== undefined) payload.content = content;
  if (tags !== undefined) payload.tags = tags;
  if (pinned !== undefined) payload.pinned = pinned;
  return request(`/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// PUBLIC_INTERFACE
export async function setNotePinned(id, pinned) {
  /** Pin or unpin a note by id. */
  return updateNote(id, { pinned: Boolean(pinned) });
}

// PUBLIC_INTERFACE
export async function deleteNote(id) {
  /** Delete a note by id. */
  return request(`/notes/${id}`, { method: "DELETE" });
}
