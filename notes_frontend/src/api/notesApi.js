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
export async function listNotes({ q, tag, tags, starred, limit = 50, offset = 0 }) {
  /**
   * List notes with optional search, tag filter(s), and starred filter.
   *
   * Contract:
   * - Provide either `tag` (single) or `tags` (array of tag names). If both are provided,
   *   `tags` takes precedence.
   * - Backend expects:
   *   - `tag=<name>` for single tag (legacy)
   *   - `tags=<comma-separated>` for multi-select tags (AND match)
   * - Starred filter:
   *   - `starred=true` to show only starred notes
   */
  const params = new URLSearchParams();
  if (q) params.set("q", q);

  const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (tagList.length > 0) {
    params.set("tags", tagList.join(","));
  } else if (tag) {
    params.set("tag", tag);
  }

  if (starred === true) params.set("starred", "true");

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
export async function updateNote(id, { title, content, tags, pinned, starred }) {
  /** Patch update a note. Provide tags to replace existing tags. */
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (content !== undefined) payload.content = content;
  if (tags !== undefined) payload.tags = tags;
  if (pinned !== undefined) payload.pinned = pinned;
  if (starred !== undefined) payload.starred = starred;
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
export async function setNoteStarred(id, starred) {
  /** Star or unstar (favorite) a note by id. */
  return updateNote(id, { starred: Boolean(starred) });
}

// PUBLIC_INTERFACE
export async function deleteNote(id) {
  /** Delete a note by id. */
  return request(`/notes/${id}`, { method: "DELETE" });
}
