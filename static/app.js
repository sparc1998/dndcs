// ── State ──────────────────────────────────────────────────────────────────

let character = null;

// Off-screen canvas used by fitInput to measure text width without touching the DOM.
const _measureCanvas = document.createElement("canvas");

// Tracks whether the link dialog is open; used to suppress edit-dialog Escape handling.
let _linkDialogOpen = false;
let _linkTarget = null;    // context saved when the link dialog opens: { el, selStart, selEnd, existingMatch }

// Tracks which field the edit dialog is currently editing.
let _editDialogField = null;          // the hidden <input> whose value is being edited
let _editDialogDisplay = null;        // the paired <span class="field-display"> to update on close
let _editDialogOriginalValue = null;  // value at open time, restored on Escape


// ── Utilities ──────────────────────────────────────────────────────────────

// Escapes <, >, &, and " so raw user text can be safely injected as innerHTML.
function escHtml(s) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

// Strips {comment} blocks from a formula string before evaluation.
function stripFormulaComments(raw) {
  return raw.replace(/\{[^}]*\}/g, "");
}

// Evaluates a numeric formula (supports + - * / and parentheses).
// Returns the numeric result as a string, or the raw escaped text on error.
function renderFormula(raw) {
  const expr = stripFormulaComments(raw).trim();
  if (!expr) return "";
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return escHtml(raw);
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function("return (" + expr + ")")();
    if (typeof result !== "number" || !isFinite(result)) return escHtml(raw);
    return String(result % 1 === 0 ? result : parseFloat(result.toFixed(10)));
  } catch {
    return escHtml(raw);
  }
}

// Converts markdown-style [label](url) syntax in raw text into HTML <a> tags.
// Any text outside link syntax is escaped and passed through as plain text.
function renderLinks(raw) {
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let result = "";
  let last = 0;
  let m;
  while ((m = linkRe.exec(raw)) !== null) {
    result += escHtml(raw.slice(last, m.index));
    result += `<a href="${escHtml(m[2])}" target="_blank" rel="noopener noreferrer">${escHtml(m[1])}</a>`;
    last = m.index + m[0].length;
  }
  result += escHtml(raw.slice(last));
  return result;
}

// Renders raw text into a display element.
// For data-formula fields the formula is evaluated and only the result is shown.
// For all other fields markdown links are rendered.
function updateDisplay(displayEl, rawText) {
  const inputId = displayEl.id.replace(/-display$/, "");
  const inputEl = document.getElementById(inputId);
  if (inputEl && inputEl.hasAttribute("data-formula")) {
    displayEl.textContent = renderFormula(rawText);
  } else {
    displayEl.innerHTML = renderLinks(rawText);
  }
}

// ── Edit dialog ────────────────────────────────────────────────────────────

// Opens the centered edit dialog for a given field input and its display span.
// Populates the textarea with the field's current raw value and focuses it.
function openEditDialog(inputEl, displayEl) {
  _editDialogField = inputEl;
  _editDialogDisplay = displayEl;
  _editDialogOriginalValue = inputEl.value;
  const ta = document.getElementById("edit-dialog-textarea");
  ta.value = inputEl.value;
  document.getElementById("edit-dialog").classList.remove("hidden");
  requestAnimationFrame(() => { ta.focus(); });
}

// Closes the edit dialog saving the current textarea value (Done button / backdrop / Cmd+Enter).
function closeEditDialog() {
  if (_editDialogField) {
    const ta = document.getElementById("edit-dialog-textarea");
    _editDialogField.value = ta.value;
    updateDisplay(_editDialogDisplay, ta.value);
    autosave();
  }
  document.getElementById("edit-dialog").classList.add("hidden");
  _editDialogField = null;
  _editDialogDisplay = null;
  _editDialogOriginalValue = null;
}

// Closes the edit dialog restoring the original value (Escape key).
function cancelEditDialog() {
  if (_editDialogField && _editDialogOriginalValue !== null) {
    _editDialogField.value = _editDialogOriginalValue;
    updateDisplay(_editDialogDisplay, _editDialogOriginalValue);
    autosave();
  }
  document.getElementById("edit-dialog").classList.add("hidden");
  _editDialogField = null;
  _editDialogDisplay = null;
  _editDialogOriginalValue = null;
}

// ── Link dialog ────────────────────────────────────────────────────────────

// Opens the link insertion dialog for the currently selected text in el.
// If the selection falls inside an existing [label](url) link, pre-fills the
// URL and shows the Remove button. Requires a non-empty selection to proceed.
function openLinkDialog(el) {
  const selStart = el.selectionStart;
  const selEnd = el.selectionEnd;
  if (selStart === selEnd) return;

  const raw = el.value;
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let existingMatch = null;
  let m;
  while ((m = linkRe.exec(raw)) !== null) {
    if (selStart >= m.index && selEnd <= m.index + m[0].length) {
      existingMatch = m;
      break;
    }
  }

  _linkTarget = { el, selStart, selEnd, existingMatch };
  _linkDialogOpen = true;

  const urlInput = document.getElementById("link-url");
  urlInput.value = existingMatch ? existingMatch[2] : "";
  document.getElementById("link-remove-btn").classList.toggle("hidden", !existingMatch);
  document.getElementById("link-dialog").classList.remove("hidden");
  requestAnimationFrame(() => { urlInput.focus(); urlInput.select(); });
}

// Hides the link dialog and optionally returns focus to the element that was
// being edited when the dialog opened.
function closeLinkDialog(returnFocus = true) {
  _linkDialogOpen = false;
  document.getElementById("link-dialog").classList.add("hidden");
  if (returnFocus && _linkTarget) _linkTarget.el.focus();
  _linkTarget = null;
}

// Applies or removes a link on the saved selection in _linkTarget.
// If url is non-empty, wraps the selected text in [label](url) markdown.
// If url is empty, strips the existing link syntax leaving just the label text.
// When editing via the edit dialog, also syncs the updated value back to the
// hidden field input so autosave reads the correct value.
function applyLink(url) {
  if (!_linkTarget) return;
  const { el, selStart, selEnd, existingMatch } = _linkTarget;
  const raw = el.value;
  let newValue;

  if (existingMatch) {
    const start = existingMatch.index;
    const end = existingMatch.index + existingMatch[0].length;
    newValue = url
      ? raw.slice(0, start) + `[${existingMatch[1]}](${url})` + raw.slice(end)
      : raw.slice(0, start) + existingMatch[1] + raw.slice(end);
  } else {
    const selectedText = raw.slice(selStart, selEnd);
    newValue = url
      ? raw.slice(0, selStart) + `[${selectedText}](${url})` + raw.slice(selEnd)
      : raw;
  }

  el.value = newValue;
  if (el === document.getElementById("edit-dialog-textarea") && _editDialogField) {
    _editDialogField.value = newValue;
  }
  autosave();
  closeLinkDialog(true);
}

// ── Layout ─────────────────────────────────────────────────────────────────

// Sizes a bio header input (and its paired display span) to fit a given string.
// Uses an off-screen canvas to measure text width at the input's computed font,
// avoiding layout reflows. The inline width is also applied to the display span
// so both elements stay the same width regardless of which is visible.
function fitInput(el, sizingText) {
  const wasHidden = el.classList.contains("hidden");
  if (wasHidden) el.classList.remove("hidden");
  const ctx = _measureCanvas.getContext("2d");
  ctx.font = getComputedStyle(el).font;
  const textW = ctx.measureText(sizingText).width;
  const cs = getComputedStyle(el);
  const padW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4;
  const w = (textW + padW) + "px";
  el.style.width = w;
  const display = document.getElementById(el.id + "-display");
  if (display) display.style.width = w;
  if (wasHidden) el.classList.add("hidden");
}

// Fetches /api/config and applies all color, font, and sizing values to the page.
// CSS custom properties are set on :root so every element inherits them.
// Input widths are set via fitInput using the sizing_text values from config.
async function applyConfig() {
  const res = await fetch("/api/config");
  const cfg = await res.json();
  const root = document.documentElement;

  const direct = [
    ["main_bg", "--main-bg"],
    ["sidebar_bg", "--sidebar-bg"],
    ["textbox_selected_bg", "--textbox-selected-bg"],
    ["textbox_unselected_bg", "--textbox-unselected-bg"],
    ["card_bg", "--card-bg"],
    ["tag_bg", "--tag-bg"],
    ["header_font", "--header-font"],
    ["header_fontcolor", "--header-fontcolor"],
    ["button_font", "--button-font"],
    ["button_fontcolor", "--button-fontcolor"],
    ["button_bg", "--button-bg"],
    ["save_button_bg", "--save-button-bg"],
    ["save_button_fontcolor", "--save-button-fontcolor"],
    ["sheet_font", "--sheet-font"],
    ["sheet_fontcolor", "--sheet-fontcolor"],
  ];
  const px = [
    ["header_font_size", "--header-font-size"],
    ["button_font_size", "--button-font-size"],
    ["sheet_font_size", "--sheet-font-size"],
  ];

  for (const [key, cssVar] of direct) {
    if (cfg[key] != null) root.style.setProperty(cssVar, cfg[key]);
  }
  for (const [key, cssVar] of px) {
    if (cfg[key] != null) root.style.setProperty(cssVar, cfg[key] + "px");
  }

  if (cfg.name_sizing_text) {
    fitInput(document.getElementById("player-name"), cfg.name_sizing_text);
    fitInput(document.getElementById("character-name"), cfg.name_sizing_text);
  }
  if (cfg.class_sizing_text)
    fitInput(document.getElementById("class"), cfg.class_sizing_text);
  if (cfg.level_sizing_text)
    fitInput(document.getElementById("level"), cfg.level_sizing_text);
  if (cfg.experience_sizing_text)
    fitInput(document.getElementById("experience"), cfg.experience_sizing_text);
}

// ── Data & render ──────────────────────────────────────────────────────────

// Entry point: fetches config and character data in parallel, then renders.
async function load() {
  const [, charRes] = await Promise.all([applyConfig(), fetch("/api/character")]);
  character = await charRes.json();
  render();
}

// Populates all bio field inputs and display spans from the character object,
// then re-renders the campaign notes list.
function render() {
  const playerRaw = character.bio?.player_name ?? "";
  const charRaw = character.bio?.character_name ?? "";
  const classRaw = character.bio?.class ?? "";
  const levelRaw = character.bio?.level ?? "";
  const experienceRaw = character.bio?.experience ?? "";
  document.getElementById("player-name").value = playerRaw;
  document.getElementById("character-name").value = charRaw;
  document.getElementById("class").value = classRaw;
  document.getElementById("level").value = levelRaw;
  document.getElementById("experience").value = experienceRaw;
  updateDisplay(document.getElementById("player-name-display"), playerRaw);
  updateDisplay(document.getElementById("character-name-display"), charRaw);
  updateDisplay(document.getElementById("class-display"), classRaw);
  updateDisplay(document.getElementById("level-display"), levelRaw);
  updateDisplay(document.getElementById("experience-display"), experienceRaw);
  renderNotes();
}

// Rebuilds the #notes-list DOM from the character's campaign_notes array.
// Each note becomes a card with tag chips and one paragraph per note entry.
function renderNotes() {
  const list = document.getElementById("notes-list");
  list.innerHTML = "";
  (character.campaign_notes ?? []).forEach((note) => {
    const card = document.createElement("div");
    card.className = "note-card";

    const tagsRow = document.createElement("div");
    tagsRow.className = "tags-row";
    (note.tags ?? []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tagsRow.appendChild(chip);
    });
    card.appendChild(tagsRow);

    (note.notes ?? []).forEach((n) => {
      const p = document.createElement("p");
      p.className = "note-entry";
      p.innerHTML = renderLinks(n);
      card.appendChild(p);
    });

    list.appendChild(card);
  });
}

// Assembles the current character object from live DOM field values.
// campaign_notes is carried over from the last loaded/saved state unchanged.
function collectCharacter() {
  return {
    bio: {
      player_name: document.getElementById("player-name").value,
      character_name: document.getElementById("character-name").value,
      class: document.getElementById("class").value,
      level: document.getElementById("level").value,
      experience: document.getElementById("experience").value,
    },
    campaign_notes: character.campaign_notes ?? [],
  };
}

// Saves the current character state to /api/character (the autosave .bak file).
// Called on every field change so no edits are lost between explicit saves.
async function autosave() {
  const data = collectCharacter();
  character = data;
  await fetch("/api/character", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// Displays a message in the sidebar status area with an ok or err style.
// Success messages auto-clear after 2.5 seconds.
function setStatus(msg, cls) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = cls;
  if (cls === "ok") setTimeout(() => (el.textContent = ""), 2500);
}

// ── Event wiring ───────────────────────────────────────────────────────────

// Open the edit dialog when clicking a data-expandable field's display span.
// Clicks on rendered links inside the span are ignored so the link can be followed.
document.querySelectorAll("[data-expandable]").forEach((input) => {
  const display = document.getElementById(input.id + "-display");
  if (display) display.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    openEditDialog(input, display);
  });
});

// Open the link dialog with cmd-k (Mac) or ctrl-k (Windows/Linux) on any
// data-linkable element, provided text is selected.
document.querySelectorAll("[data-linkable]").forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openLinkDialog(el); }
  });
});

// Edit dialog: Done button, Escape key, and textarea sync.
document.getElementById("edit-dialog-done-btn").addEventListener("click", closeEditDialog);
document.getElementById("edit-dialog").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !_linkDialogOpen) cancelEditDialog();
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) closeEditDialog();
});
document.getElementById("edit-dialog-textarea").addEventListener("input", () => {
  // Sync the textarea's value back to the hidden field input on every keystroke
  // so autosave always reads the correct value even before the dialog is closed.
  if (_editDialogField) {
    _editDialogField.value = document.getElementById("edit-dialog-textarea").value;
    autosave();
  }
});

// Link dialog: OK button, Remove button, Cancel button, and keyboard shortcuts.
document.getElementById("link-ok-btn").addEventListener("click", () => {
  applyLink(document.getElementById("link-url").value.trim());
});
document.getElementById("link-remove-btn").addEventListener("click", () => applyLink(""));
document.getElementById("link-cancel-btn").addEventListener("click", () => closeLinkDialog(true));
document.getElementById("link-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyLink(document.getElementById("link-url").value.trim());
  if (e.key === "Escape") closeLinkDialog(true);
});
document.getElementById("link-dialog").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLinkDialog(true);
});

// Autosave bio fields on every keystroke (these inputs are normally hidden behind
// their display spans, but they remain the source of truth for collectCharacter).
document.getElementById("player-name").addEventListener("input", autosave);
document.getElementById("character-name").addEventListener("input", autosave);
document.getElementById("class").addEventListener("input", autosave);
document.getElementById("level").addEventListener("input", autosave);
document.getElementById("experience").addEventListener("input", autosave);

// Add Note button: parse tags, append a new note to character state, and autosave.
document.getElementById("add-note-btn").addEventListener("click", async () => {
  const rawTags = document.getElementById("new-tags").value;
  const rawNote = document.getElementById("new-note").value.trim();
  if (!rawNote) return;
  const tags = rawTags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) tags.push("general");
  character.campaign_notes = character.campaign_notes ?? [];
  character.campaign_notes.push({ tags, notes: [rawNote] });
  document.getElementById("new-tags").value = "";
  document.getElementById("new-note").value = "";
  renderNotes();
  await autosave();
});

// Save button: writes current state to the output file via /api/save and
// shows a success or error message in the sidebar.
document.getElementById("save-btn").addEventListener("click", async () => {
  try {
    const data = collectCharacter();
    character = data;
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.ok) {
      setStatus("Saved!", "ok");
    } else {
      setStatus("Error: " + json.error, "err");
    }
  } catch (e) {
    setStatus("Save failed", "err");
  }
});

// Tab buttons: toggle .active on the button and its corresponding panel.
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ── Init ───────────────────────────────────────────────────────────────────

load();
