import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { createNote, deleteNote, listNotes, setNotePinned, updateNote } from "./api/notesApi";

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function truncate(s, n) {
  if (!s) return "";
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

function parseTagsInput(value) {
  // Accept: "tag1, tag2" -> ["tag1","tag2"]
  return (value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function uniqueSortedTagsFromNotes(notes) {
  const set = new Set();
  notes.forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// PUBLIC_INTERFACE
function App() {
  /** NoteMaster application root component. */

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [notes, setNotes] = useState([]);
  const [total, setTotal] = useState(0);

  const [selectedId, setSelectedId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // create | edit
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");

  const searchDebounceRef = useRef(null);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) || null,
    [notes, selectedId]
  );

  const availableTags = useMemo(() => uniqueSortedTagsFromNotes(notes), [notes]);

  const pinnedNotes = useMemo(() => notes.filter((n) => Boolean(n.pinned)), [notes]);
  const otherNotes = useMemo(() => notes.filter((n) => !Boolean(n.pinned)), [notes]);

  const load = async ({ q, tag } = {}) => {
    setLoading(true);
    setError("");
    try {
      const data = await listNotes({ q: q ?? query, tag: tag ?? tagFilter, limit: 100, offset: 0 });
      setNotes(data.items || []);
      setTotal(data.total || 0);

      // keep selection stable; if selected note disappears, clear it.
      setSelectedId((prev) => {
        if (!prev) return (data.items && data.items[0] && data.items[0].id) || null;
        const stillThere = (data.items || []).some((n) => n.id === prev);
        return stillThere ? prev : ((data.items && data.items[0] && data.items[0].id) || null);
      });
    } catch (e) {
      setError(e?.message || "Failed to load notes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChangeQuery = (value) => {
    setQuery(value);

    // Debounced search to avoid excessive calls.
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      load({ q: value });
    }, 250);
  };

  const onChangeTagFilter = (value) => {
    setTagFilter(value);
    load({ tag: value });
  };

  const openCreate = () => {
    setModalMode("create");
    setDraftTitle("");
    setDraftContent("");
    setDraftTags("");
    setModalOpen(true);
  };

  const openEdit = () => {
    if (!selectedNote) return;
    setModalMode("edit");
    setDraftTitle(selectedNote.title || "");
    setDraftContent(selectedNote.content || "");
    setDraftTags((selectedNote.tags || []).join(", "));
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const saveDraft = async () => {
    const title = draftTitle.trim();
    const content = draftContent;
    const tags = parseTagsInput(draftTags);

    if (!title) {
      setError("Title is required.");
      return;
    }
    if (!content.trim()) {
      setError("Content is required.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (modalMode === "create") {
        const created = await createNote({ title, content, tags });
        await load();
        setSelectedId(created.id);
      } else if (modalMode === "edit" && selectedNote) {
        const updated = await updateNote(selectedNote.id, { title, content, tags });
        await load();
        setSelectedId(updated.id);
      }
      setModalOpen(false);
    } catch (e) {
      setError(e?.message || "Save failed.");
    } finally {
      setLoading(false);
    }
  };

  const doDelete = async () => {
    if (!selectedNote) return;

    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete note "${selectedNote.title}"? This cannot be undone.`);
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      await deleteNote(selectedNote.id);
      await load();
    } catch (e) {
      setError(e?.message || "Delete failed.");
    } finally {
      setLoading(false);
    }
  };

  const togglePinned = async () => {
    if (!selectedNote) return;
    setLoading(true);
    setError("");
    try {
      const nextPinned = !Boolean(selectedNote.pinned);
      await setNotePinned(selectedNote.id, nextPinned);
      await load();
      setSelectedId(selectedNote.id);
    } catch (e) {
      setError(e?.message || "Failed to update pinned state.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <div className="header">
        <div className="container">
          <div className="headerInner">
            <div className="brand">
              <p className="brandTitle">NoteMaster</p>
              <p className="brandSub">Fast notes with search + tags</p>
            </div>

            <div className="searchWrap">
              <input
                className="input"
                value={query}
                onChange={(e) => onChangeQuery(e.target.value)}
                placeholder="Search notes…"
                aria-label="Search notes"
              />

              <div className="pill" aria-label="Tag filter">
                <span style={{ fontWeight: 700 }}>Tag</span>
                <select
                  value={tagFilter}
                  onChange={(e) => onChangeTagFilter(e.target.value)}
                  style={{
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "inherit",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  aria-label="Filter by tag"
                >
                  <option value="">All</option>
                  {availableTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn btnPrimary" onClick={openCreate} disabled={loading}>
                New note
              </button>
            </div>
          </div>

          {error ? <div className="errorBanner">{error}</div> : null}
        </div>
      </div>

      <main className="main">
        <div className="container">
          <div className="grid">
            <section className="panel" aria-label="Notes list">
              <div className="panelHeader">
                <div>
                  <p className="panelTitle">Notes</p>
                  <p className="smallMuted">
                    {loading ? "Loading…" : `${total} total`}
                  </p>
                </div>
                <button className="btn" onClick={() => load()} disabled={loading}>
                  Refresh
                </button>
              </div>

              <div className="list">
                {notes.length === 0 ? (
                  <div className="emptyState">
                    No notes found. Create one with “New note”.
                  </div>
                ) : (
                  <>
                    {pinnedNotes.length > 0 ? (
                      <div className="listSection" aria-label="Pinned notes section">
                        <div className="listSectionHeader">
                          <span className="listSectionTitle">Pinned</span>
                          <span className="listSectionCount">{pinnedNotes.length}</span>
                        </div>
                        {pinnedNotes.map((n) => (
                          <div
                            key={n.id}
                            className={[
                              "noteRow",
                              "noteRowPinned",
                              selectedId === n.id ? "noteRowActive" : "",
                            ].join(" ")}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedId(n.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") setSelectedId(n.id);
                            }}
                            aria-label={`Open pinned note ${n.title}`}
                          >
                            <div className="noteTitleRow">
                              <p className="noteTitle">{n.title}</p>
                              <span className="pinBadge" aria-label="Pinned">
                                Pinned
                              </span>
                            </div>
                            <p className="noteExcerpt">{truncate(n.content, 120)}</p>
                            {n.tags && n.tags.length > 0 ? (
                              <div className="tagLine" aria-label="Tags">
                                {n.tags.slice(0, 6).map((t) => (
                                  <span key={t} className="tag">
                                    {t}
                                  </span>
                                ))}
                                {n.tags.length > 6 ? (
                                  <span className="tag">+{n.tags.length - 6}</span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="listSection" aria-label="All notes section">
                      {pinnedNotes.length > 0 ? (
                        <div className="listSectionHeader">
                          <span className="listSectionTitle">All notes</span>
                          <span className="listSectionCount">{otherNotes.length}</span>
                        </div>
                      ) : null}

                      {otherNotes.map((n) => (
                        <div
                          key={n.id}
                          className={[
                            "noteRow",
                            selectedId === n.id ? "noteRowActive" : "",
                          ].join(" ")}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(n.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") setSelectedId(n.id);
                          }}
                          aria-label={`Open note ${n.title}`}
                        >
                          <p className="noteTitle">{n.title}</p>
                          <p className="noteExcerpt">{truncate(n.content, 120)}</p>
                          {n.tags && n.tags.length > 0 ? (
                            <div className="tagLine" aria-label="Tags">
                              {n.tags.slice(0, 6).map((t) => (
                                <span key={t} className="tag">
                                  {t}
                                </span>
                              ))}
                              {n.tags.length > 6 ? (
                                <span className="tag">+{n.tags.length - 6}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="panel" aria-label="Note details">
              <div className="panelHeader">
                <div>
                  <p className="panelTitle">Details</p>
                  <p className="smallMuted">
                    {selectedNote ? `ID ${selectedNote.id}` : "Select a note"}
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="btn"
                    onClick={togglePinned}
                    disabled={!selectedNote || loading}
                    aria-label={selectedNote && selectedNote.pinned ? "Unpin note" : "Pin note"}
                    title={selectedNote && selectedNote.pinned ? "Unpin" : "Pin"}
                  >
                    {selectedNote && selectedNote.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button className="btn" onClick={openEdit} disabled={!selectedNote || loading}>
                    Edit
                  </button>
                  <button
                    className="btn btnDanger"
                    onClick={doDelete}
                    disabled={!selectedNote || loading}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {!selectedNote ? (
                <div className="detailBody">
                  <div className="emptyState">Pick a note from the list to view it here.</div>
                </div>
              ) : (
                <div className="detailBody">
                  <h2 className="detailTitle">{selectedNote.title}</h2>
                  <div className="detailMeta">
                    <span>Updated: {formatDate(selectedNote.updated_at)}</span>
                    <span>Created: {formatDate(selectedNote.created_at)}</span>
                  </div>

                  {selectedNote.tags && selectedNote.tags.length > 0 ? (
                    <div className="tagLine" style={{ marginBottom: 12 }}>
                      {selectedNote.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="detailContent">{selectedNote.content}</div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <button className="fab" onClick={openCreate} aria-label="Create note">
        +
      </button>

      {modalOpen ? (
        <div
          className="backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={modalMode === "create" ? "Create note" : "Edit note"}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal">
            <div className="modalHeader">
              <p className="modalTitle">{modalMode === "create" ? "New note" : "Edit note"}</p>
              <button className="btn" onClick={closeModal} disabled={loading}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <input
                className="input"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title"
                aria-label="Note title"
              />
              <textarea
                className="textarea"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder="Write your note…"
                aria-label="Note content"
              />
              <input
                className="input"
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="Tags (comma-separated, optional)"
                aria-label="Note tags"
              />
            </div>
            <div className="footerRow">
              <button className="btn" onClick={closeModal} disabled={loading}>
                Cancel
              </button>
              <button className="btn btnPrimary" onClick={saveDraft} disabled={loading}>
                {modalMode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
