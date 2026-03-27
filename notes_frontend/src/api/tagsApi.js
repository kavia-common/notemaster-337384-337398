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

  return res.json();
}

// PUBLIC_INTERFACE
export async function listTags() {
  /** List all tags known to the system. */
  return request("/tags", { method: "GET" });
}

// PUBLIC_INTERFACE
export async function createTag({ name }) {
  /** Create a tag by name (normalized server-side). */
  return request("/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

// PUBLIC_INTERFACE
export async function renameTag(tagId, { name }) {
  /** Rename a tag by id. */
  return request(`/tags/${tagId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

// PUBLIC_INTERFACE
export async function deleteTag(tagId) {
  /** Delete a tag by id. Notes will lose this tag association. */
  return request(`/tags/${tagId}`, { method: "DELETE" });
}
