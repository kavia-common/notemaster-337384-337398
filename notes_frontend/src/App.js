import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  bulkAddTags,
  bulkDeleteNotes,
  bulkRemoveTags,
  createNote,
  deleteNote,
  listNotes,
  setNotePinned,
  setNoteStarred,
  updateNote,
} from "./api/notesApi";
import { createTag, deleteTag, listTags, renameTag } from "./api/tagsApi";

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

/**
 * Note sorting options supported by the UI.
 *
 * Contract:
 * - Input: `sortKey` in {"updated","newest","title"}.
 * - Output: comparator function for Array.prototype.sort.
 * - Invariants:
 *   - Sorting is stable via tiebreakers: pinned desc -> primary key -> title -> id.
 *   - Dates are treated as ISO strings; invalid dates become epoch 0.
 */
const NOTE_SORT = {
  updated: { label: "Updated", key: "updated" },
  newest: { label: "Newest", key: "newest" },
  title: { label: "Title", key: "title" },
};

function safeTime(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : 0;
}

function compareStrings(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

/**
 * Sort notes consistently for both normal listing and search results.
 *
 * Contract:
 * - Inputs:
 *   - `notes`: array of note objects (expects {id,title,created_at,updated_at,pinned}).
 *   - `sortKey`: one of NOTE_SORT keys.
 * - Output: new array (does not mutate input).
 * - Errors: none (defensive conversion).
 */
function sortNotesFlow(notes, sortKey) {
  const key = NOTE_SORT[sortKey]?.key || NOTE_SORT.updated.key;

  const toSorted = (arr) =>
    [...arr].sort((a, b) => {
      // Keep pinned grouped first, regardless of sort selection.
      const pinnedA = Boolean(a?.pinned);
      const pinnedB = Boolean(b?.pinned);
      if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;

      if (key === "title") {
        const c = compareStrings(a?.title, b?.title);
        if (c !== 0) return c;
      } else if (key === "newest") {
        const c = safeTime(b?.created_at) - safeTime(a?.created_at);
        if (c !== 0) return c;
      } else {
        // "updated" (default)
        const c = safeTime(b?.updated_at) - safeTime(a?.updated_at);
        if (c !== 0) return c;
      }

      // Stable/consistent tiebreakers.
      const titleTie = compareStrings(a?.title, b?.title);
      if (titleTie !== 0) return titleTie;

      return compareStrings(a?.id, b?.id);
    });

  return toSorted(notes || []);
}

function normalizeTagNameUi(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// PUBLIC_INTERFACE
function App() {
  /** NoteMaster application root component. */

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(NOTE_SORT.updated.key);
  const [starredOnly, setStarredOnly] = useState(false);

  const [rawNotes, setRawNotes] = useState([]);
  const [total, setTotal] = useState(0);

  const [selectedId, setSelectedId] = useState(null);

  // Bulk selection state
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // Set<number>
  const [bulkTagInput, setBulkTagInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Notes create/edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // create | edit
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");

  // Tags management + filtering state
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState("");
  const [tags, setTags] = useState([]); // [{id,name,created_at}]
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]); // array of tag names

  const searchDebounceRef = useRef(null);

  const notes = useMemo(() => sortNotesFlow(rawNotes, sortKey), [rawNotes, sortKey]);

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedId) || null, [notes, selectedId]);

  const pinnedNotes = useMemo(() => notes.filter((n) => Boolean(n.pinned)), [notes]);
  const otherNotes = useMemo(() => notes.filter((n) => !Boolean(n.pinned)), [notes]);

  const selectedTagsSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const loadTags = async () => {
    setTagsLoading(true);
    setTagsError("");
    try {
      const data = await listTags();
      setTags((data.items || []).slice().sort((a, b) => compareStrings(a?.name, b?.name)));
    } catch (e) {
      setTagsError(e?.message || "Failed to load tags.");
    } finally {
      setTagsLoading(false);
    }
  };

  const loadNotes = async ({ q, tags: tagsArg, starred } = {}) => {
    setLoading(true);
    setError("");
    try {
      const data = await listNotes({
        q: q ?? query,
        tags: tagsArg ?? selectedTags,
        starred: starred ?? starredOnly,
        limit: 100,
        offset: 0,
      });

      const items = data.items || [];
      setRawNotes(items);
      setTotal(data.total || 0);

      // keep selection stable; if selected note disappears, select the first item post-sort.
      setSelectedId((prev) => {
        const sorted = sortNotesFlow(items, sortKey);
        const first = (sorted && sorted[0] && sorted[0].id) || null;

        if (!prev) return first;
        const stillThere = (items || []).some((n) => n.id === prev);
        return stillThere ? prev : first;
      });

      // If multi-select is enabled, prune selectedIds that no longer exist.
      setSelectedIds((prev) => {
        if (!multiSelect) return prev;
        const existing = new Set((items || []).map((n) => n.id));
        const next = new Set();
        prev.forEach((id) => {
          if (existing.has(id)) next.add(id);
        });
        return next;
      });
    } catch (e) {
      setError(e?.message || "Failed to load notes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChangeQuery = (value) => {
    setQuery(value);

    // Debounced search to avoid excessive calls.
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      loadNotes({ q: value, starred: starredOnly });
    }, 250);
  };

  const onChangeSort = (value) => {
    setSortKey(value);

    // Keep selection stable in case the top item changes after sorting.
    // If selected note exists, keep it; else select the new first.
    setSelectedId((prev) => {
      if (prev && (rawNotes || []).some((n) => n.id === prev)) return prev;
      const sorted = sortNotesFlow(rawNotes, value);
      return (sorted[0] && sorted[0].id) || null;
    });
  };

  const toggleTagSelected = async (tagName) => {
    const t = normalizeTagNameUi(tagName);
    const next = selectedTagsSet.has(t) ? selectedTags.filter((x) => x !== t) : [...selectedTags, t].sort(compareStrings);
    setSelectedTags(next);
    setTagPickerOpen(true); // keep open for quick multi-select
    await loadNotes({ tags: next });
  };

  const clearTagFilter = async () => {
    setSelectedTags([]);
    await loadNotes({ tags: [], starred: starredOnly });
  };

  const toggleStarredOnly = async () => {
    const next = !starredOnly;
    setStarredOnly(next);
    await loadNotes({ starred: next });
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
    const tagsList = parseTagsInput(draftTags);

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
        const created = await createNote({ title, content, tags: tagsList });
        await Promise.all([loadNotes(), loadTags()]);
        setSelectedId(created.id);
      } else if (modalMode === "edit" && selectedNote) {
        const updated = await updateNote(selectedNote.id, { title, content, tags: tagsList });
        await Promise.all([loadNotes(), loadTags()]);
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
      await Promise.all([loadNotes(), loadTags()]);
    } catch (e) {
      setError(e?.message || "Delete failed.");
    } finally {
      setLoading(false);
    }
  };

  const selectedIdsArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const selectedCount = selectedIds.size;

  const toggleMultiSelect = () => {
    setMultiSelect((v) => {
      const next = !v;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  };

  const toggleIdSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set((notes || []).map((n) => n.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const doBulkDelete = async () => {
    if (selectedCount === 0) return;

    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete ${selectedCount} selected note(s)? This cannot be undone.`);
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      const res = await bulkDeleteNotes(selectedIdsArray);
      const notFound = res?.not_found_ids?.length ? ` (${res.not_found_ids.length} not found)` : "";
      await Promise.all([loadNotes(), loadTags()]);
      setSelectedIds(new Set());
      setError(res?.deleted_ids?.length ? "" : `No notes deleted${notFound}.`);
    } catch (e) {
      setError(e?.message || "Bulk delete failed.");
    } finally {
      setLoading(false);
    }
  };

  const doBulkAddTags = async () => {
    const tagsList = parseTagsInput(bulkTagInput);
    if (selectedCount === 0) return;
    if (tagsList.length === 0) {
      setError("Enter at least one tag to add.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await bulkAddTags(selectedIdsArray, tagsList);
      await Promise.all([loadNotes(), loadTags()]);
      setBulkTagInput("");
      setSelectedIds(new Set());
    } catch (e) {
      setError(e?.message || "Bulk add tags failed.");
    } finally {
      setLoading(false);
    }
  };

  const doBulkRemoveTags = async () => {
    const tagsList = parseTagsInput(bulkTagInput);
    if (selectedCount === 0) return;
    if (tagsList.length === 0) {
      setError("Enter at least one tag to remove.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await bulkRemoveTags(selectedIdsArray, tagsList);
      await Promise.all([loadNotes(), loadTags()]);
      setBulkTagInput("");
      setSelectedIds(new Set());
    } catch (e) {
      setError(e?.message || "Bulk remove tags failed.");
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
      await loadNotes();
      setSelectedId(selectedNote.id);
    } catch (e) {
      setError(e?.message || "Failed to update pinned state.");
    } finally {
      setLoading(false);
    }
  };

  const toggleStarred = async () => {
    if (!selectedNote) return;
    setLoading(true);
    setError("");
    try {
      const nextStarred = !Boolean(selectedNote.starred);
      await setNoteStarred(selectedNote.id, nextStarred);
      await loadNotes();
      setSelectedId(selectedNote.id);
    } catch (e) {
      setError(e?.message || "Failed to update starred state.");
    } finally {
      setLoading(false);
    }
  };

  const openTagsManager = async () => {
    setTagsModalOpen(true);
    await loadTags();
  };

  const closeTagsManager = () => setTagsModalOpen(false);

  const doCreateTag = async (name) => {
    const n = normalizeTagNameUi(name);
    if (!n) {
      setTagsError("Tag name is required.");
      return;
    }

    setTagsLoading(true);
    setTagsError("");
    try {
      await createTag({ name: n });
      await Promise.all([loadTags(), loadNotes()]);
    } catch (e) {
      setTagsError(e?.message || "Failed to create tag.");
    } finally {
      setTagsLoading(false);
    }
  };

  const doRenameTag = async (tagId, name) => {
    const n = normalizeTagNameUi(name);
    if (!n) {
      setTagsError("Tag name is required.");
      return;
    }

    setTagsLoading(true);
    setTagsError("");
    try {
      await renameTag(tagId, { name: n });

      // If user renamed a tag that is currently selected in filter, update filter selection.
      setSelectedTags((prev) => {
        const old = tags.find((t) => t.id === tagId)?.name;
        if (!old) return prev;
        const normOld = normalizeTagNameUi(old);
        const has = prev.includes(normOld);
        if (!has) return prev;
        const next = prev.filter((x) => x !== normOld).concat([n]);
        return Array.from(new Set(next)).sort(compareStrings);
      });

      await Promise.all([loadTags(), loadNotes()]);
    } catch (e) {
      setTagsError(e?.message || "Failed to rename tag.");
    } finally {
      setTagsLoading(false);
    }
  };

  const doDeleteTag = async (tagId) => {
    // eslint-disable-next-line no-alert
    const ok = window.confirm("Delete this tag? It will be removed from all notes.");
    if (!ok) return;

    setTagsLoading(true);
    setTagsError("");
    try {
      const old = tags.find((t) => t.id === tagId)?.name;
      await deleteTag(tagId);

      // Remove from selected filter if needed.
      if (old) {
        const normOld = normalizeTagNameUi(old);
        setSelectedTags((prev) => prev.filter((x) => x !== normOld));
      }

      await Promise.all([loadTags(), loadNotes()]);
    } catch (e) {
      setTagsError(e?.message || "Failed to delete tag.");
    } finally {
      setTagsLoading(false);
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

              <div className="pill" aria-label="Tags filter">
                <span style={{ fontWeight: 800 }}>Tags</span>

                <button
                  className="btn btnSmall"
                  type="button"
                  onClick={() => setTagPickerOpen((v) => !v)}
                  disabled={loading}
                  aria-label="Open tags filter"
                  title="Filter by tags"
                >
                  {selectedTags.length === 0 ? "All" : `${selectedTags.length} selected`}
                </button>

                {selectedTags.length > 0 ? (
                  <button
                    className="btn btnSmall"
                    type="button"
                    onClick={clearTagFilter}
                    disabled={loading}
                    aria-label="Clear tag filters"
                    title="Clear filters"
                  >
                    Clear
                  </button>
                ) : null}

                <button
                  className="btn btnSmall"
                  type="button"
                  onClick={openTagsManager}
                  disabled={loading}
                  aria-label="Manage tags"
                  title="Manage tags"
                >
                  Manage
                </button>
              </div>

              <div className="pill" aria-label="Starred filter">
                <span style={{ fontWeight: 800 }}>Starred</span>
                <button
                  className={["btn", "btnSmall", starredOnly ? "btnStarActive" : ""].join(" ")}
                  type="button"
                  onClick={toggleStarredOnly}
                  disabled={loading}
                  aria-pressed={starredOnly}
                  aria-label={starredOnly ? "Show all notes" : "Show only starred notes"}
                  title={starredOnly ? "Showing starred only (click to show all)" : "Show starred only"}
                >
                  {starredOnly ? "On" : "Off"}
                </button>
              </div>

              <div className="pill" aria-label="Sort notes">
                <span style={{ fontWeight: 700 }}>Sort</span>
                <select
                  value={sortKey}
                  onChange={(e) => onChangeSort(e.target.value)}
                  style={{
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "inherit",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  aria-label="Sort notes"
                >
                  {Object.values(NOTE_SORT).map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn btnPrimary" onClick={openCreate} disabled={loading}>
                New note
              </button>
            </div>
          </div>

          {tagPickerOpen ? (
            <div className="tagFilterPanel" role="region" aria-label="Tag filter panel">
              <div className="tagFilterHeader">
                <div className="smallMuted">
                  {selectedTags.length === 0
                    ? "Select one or more tags (AND match)."
                    : `Filtering by: ${selectedTags.join(", ")}`}
                </div>
                <button className="btn btnSmall" type="button" onClick={() => setTagPickerOpen(false)}>
                  Close
                </button>
              </div>

              {tagsLoading ? (
                <div className="emptyState">Loading tags…</div>
              ) : tags.length === 0 ? (
                <div className="emptyState">No tags yet. Use “Manage” to create one.</div>
              ) : (
                <div className="tagChips" aria-label="Available tags">
                  {tags.map((t) => {
                    const active = selectedTagsSet.has(normalizeTagNameUi(t.name));
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={["tagChip", active ? "tagChipActive" : ""].join(" ")}
                        onClick={() => toggleTagSelected(t.name)}
                        aria-pressed={active}
                        aria-label={`Filter by tag ${t.name}`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

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
                  <p className="smallMuted">{loading ? "Loading…" : `${total} total`}</p>
                </div>

                <div className="actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    className={["btn", multiSelect ? "btnStarActive" : ""].join(" ")}
                    type="button"
                    onClick={toggleMultiSelect}
                    disabled={loading}
                    aria-pressed={multiSelect}
                    title={multiSelect ? "Exit multi-select" : "Multi-select"}
                  >
                    {multiSelect ? `Multi-select: ${selectedCount}` : "Multi-select"}
                  </button>

                  {multiSelect ? (
                    <>
                      <button className="btn" type="button" onClick={selectAllVisible} disabled={loading || notes.length === 0}>
                        Select all
                      </button>
                      <button className="btn" type="button" onClick={clearSelection} disabled={loading || selectedCount === 0}>
                        Clear
                      </button>
                      <button className="btn btnDanger" type="button" onClick={doBulkDelete} disabled={loading || selectedCount === 0}>
                        Delete selected
                      </button>
                    </>
                  ) : null}

                  <button className="btn" onClick={() => loadNotes()} disabled={loading}>
                    Refresh
                  </button>
                </div>
              </div>

              {multiSelect ? (
                <div className="listSectionHeader" aria-label="Bulk tag actions">
                  <span className="listSectionTitle">Bulk tags</span>
                  <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <input
                      className="input"
                      style={{ width: 240 }}
                      value={bulkTagInput}
                      onChange={(e) => setBulkTagInput(e.target.value)}
                      placeholder="tag1, tag2"
                      aria-label="Bulk tags input"
                      disabled={loading}
                    />
                    <button className="btn btnPrimary" type="button" onClick={doBulkAddTags} disabled={loading || selectedCount === 0}>
                      Add
                    </button>
                    <button className="btn" type="button" onClick={doBulkRemoveTags} disabled={loading || selectedCount === 0}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="list">
                {notes.length === 0 ? (
                  <div className="emptyState">No notes found. Create one with “New note”.</div>
                ) : (
                  <>
                    {pinnedNotes.length > 0 ? (
                      <div className="listSection" aria-label="Pinned notes section">
                        <div className="listSectionHeader">
                          <span className="listSectionTitle">Pinned</span>
                          <span className="listSectionCount">{pinnedNotes.length}</span>
                        </div>
                        {pinnedNotes.map((n) => {
                          const checked = selectedIds.has(n.id);
                          return (
                            <div
                              key={n.id}
                              className={[
                                "noteRow",
                                "noteRowPinned",
                                selectedId === n.id ? "noteRowActive" : "",
                                multiSelect && checked ? "noteRowSelected" : "",
                              ].join(" ")}
                              role="button"
                              tabIndex={0}
                              onClick={() => (multiSelect ? toggleIdSelected(n.id) : setSelectedId(n.id))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  if (multiSelect) toggleIdSelected(n.id);
                                  else setSelectedId(n.id);
                                }
                              }}
                              aria-label={multiSelect ? `Select pinned note ${n.title}` : `Open pinned note ${n.title}`}
                            >
                              <div className="noteTitleRow">
                                <p className="noteTitle" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  {multiSelect ? (
                                    <input
                                      className="noteCheckbox"
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleIdSelected(n.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label={`Select note ${n.title}`}
                                    />
                                  ) : null}
                                  <span>
                                    {n.starred ? <span className="starBadge" aria-label="Starred">★</span> : null}
                                    {n.title}
                                  </span>
                                </p>
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
                                  {n.tags.length > 6 ? <span className="tag">+{n.tags.length - 6}</span> : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="listSection" aria-label="All notes section">
                      {pinnedNotes.length > 0 ? (
                        <div className="listSectionHeader">
                          <span className="listSectionTitle">All notes</span>
                          <span className="listSectionCount">{otherNotes.length}</span>
                        </div>
                      ) : null}

                      {otherNotes.map((n) => {
                        const checked = selectedIds.has(n.id);
                        return (
                          <div
                            key={n.id}
                            className={[
                              "noteRow",
                              selectedId === n.id ? "noteRowActive" : "",
                              multiSelect && checked ? "noteRowSelected" : "",
                            ].join(" ")}
                            role="button"
                            tabIndex={0}
                            onClick={() => (multiSelect ? toggleIdSelected(n.id) : setSelectedId(n.id))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                if (multiSelect) toggleIdSelected(n.id);
                                else setSelectedId(n.id);
                              }
                            }}
                            aria-label={multiSelect ? `Select note ${n.title}` : `Open note ${n.title}`}
                          >
                            <p className="noteTitle" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {multiSelect ? (
                                <input
                                  className="noteCheckbox"
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleIdSelected(n.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Select note ${n.title}`}
                                />
                              ) : null}
                              <span>
                                {n.starred ? <span className="starBadge" aria-label="Starred">★</span> : null}
                                {n.title}
                              </span>
                            </p>
                            <p className="noteExcerpt">{truncate(n.content, 120)}</p>
                            {n.tags && n.tags.length > 0 ? (
                              <div className="tagLine" aria-label="Tags">
                                {n.tags.slice(0, 6).map((t) => (
                                  <span key={t} className="tag">
                                    {t}
                                  </span>
                                ))}
                                {n.tags.length > 6 ? <span className="tag">+{n.tags.length - 6}</span> : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="panel" aria-label="Note details">
              <div className="panelHeader">
                <div>
                  <p className="panelTitle">Details</p>
                  <p className="smallMuted">{selectedNote ? `ID ${selectedNote.id}` : "Select a note"}</p>
                </div>
                <div className="actions">
                  <button
                    className={["btn", selectedNote && selectedNote.starred ? "btnStarActive" : ""].join(" ")}
                    onClick={toggleStarred}
                    disabled={!selectedNote || loading}
                    aria-label={selectedNote && selectedNote.starred ? "Unstar note" : "Star note"}
                    title={selectedNote && selectedNote.starred ? "Unstar" : "Star"}
                  >
                    {selectedNote && selectedNote.starred ? "★ Starred" : "☆ Star"}
                  </button>
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
                  <button className="btn btnDanger" onClick={doDelete} disabled={!selectedNote || loading}>
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

      {tagsModalOpen ? (
        <TagsManagerModal
          loading={tagsLoading}
          error={tagsError}
          tags={tags}
          onClose={closeTagsManager}
          onCreate={doCreateTag}
          onRename={doRenameTag}
          onDelete={doDeleteTag}
        />
      ) : null}
    </div>
  );
}

function TagsManagerModal({ loading, error, tags, onClose, onCreate, onRename, onDelete }) {
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  const startEdit = (tag) => {
    setEditId(tag.id);
    setEditName(tag.name);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
  };

  return (
    <div
      className="backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Manage tags"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalHeader">
          <p className="modalTitle">Manage tags</p>
          <button className="btn" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>

        <div className="modalBody">
          <div className="rowBetween">
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New tag name (e.g. work)"
              aria-label="New tag name"
            />
            <button
              className="btn btnPrimary"
              type="button"
              onClick={() => {
                const v = newName;
                setNewName("");
                onCreate(v);
              }}
              disabled={loading}
            >
              Create
            </button>
          </div>

          {error ? <div className="errorBanner">{error}</div> : null}

          {tags.length === 0 ? (
            <div className="emptyState">No tags created yet.</div>
          ) : (
            <div className="tagsTable" role="table" aria-label="Tags list">
              {tags.map((t) => {
                const editing = editId === t.id;
                return (
                  <div className="tagsRow" key={t.id} role="row">
                    <div className="tagsCell" role="cell">
                      {editing ? (
                        <input
                          className="input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label={`Edit tag ${t.name}`}
                        />
                      ) : (
                        <span className="tagName">{t.name}</span>
                      )}
                    </div>

                    <div className="tagsActions" role="cell">
                      {editing ? (
                        <>
                          <button
                            className="btn btnSmall btnPrimary"
                            type="button"
                            onClick={() => {
                              const name = editName;
                              cancelEdit();
                              onRename(t.id, name);
                            }}
                            disabled={loading}
                          >
                            Save
                          </button>
                          <button className="btn btnSmall" type="button" onClick={cancelEdit} disabled={loading}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btnSmall" type="button" onClick={() => startEdit(t)} disabled={loading}>
                            Rename
                          </button>
                          <button
                            className="btn btnSmall btnDanger"
                            type="button"
                            onClick={() => onDelete(t.id)}
                            disabled={loading}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="footerRow">
          <button className="btn" onClick={onClose} disabled={loading}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
