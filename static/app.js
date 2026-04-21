// ── State ──────────────────────────────────────────────────────────────────

let character = null;

const _isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const _modKey = _isMac ? "⌘" : "Ctrl";

// Off-screen canvas used by fitInput to measure text width without touching the DOM.
const _measureCanvas = document.createElement("canvas");

// Tracks whether the link dialog is open; used to suppress edit-dialog Escape handling.
let _linkDialogOpen = false;
let _linkTarget = null;    // context saved when the link dialog opens: { el, selStart, selEnd, existingMatch }

// Tracks which field the edit dialog is currently editing.
let _editDialogField = null;          // the hidden <input> whose value is being edited
let _editDialogDisplay = null;        // the paired <span class="field-display"> to update on close
let _editDialogOriginalValue = null;  // value at open time, restored on Escape

// Undo stack for dialog saves: each entry is { field, display, value } representing
// the state before that save, so Cmd/Ctrl+Z can restore it.
const _undoStack = [];


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

// Renders inline markup: [label](url) links, **bold**, and _italic_.
// Text outside any markup is HTML-escaped.
function renderInline(raw) {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|_([^_]+)_/g;
  let result = "";
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    result += escHtml(raw.slice(last, m.index));
    if (m[1] !== undefined) {
      result += `<a href="${escHtml(m[2])}" target="_blank" rel="noopener noreferrer">${escHtml(m[1])}</a>`;
    } else if (m[3] !== undefined) {
      result += `<strong>${escHtml(m[3])}</strong>`;
    } else {
      result += `<em>${escHtml(m[4])}</em>`;
    }
    last = m.index + m[0].length;
  }
  result += escHtml(raw.slice(last));
  return result;
}

// Renders raw text with link, bullet-point, and numbered-list formatting.
// Lines starting with "* " become <ul><li> elements.
// Lines starting with "<digits>) " become <ol><li> elements (any number works).
// Consecutive lines of the same list type are grouped together.
// <br> is only inserted between two non-block parts so lists don't add extra
// whitespace; use a blank line in the source to get intentional extra spacing.
function renderFormatted(raw) {
  const lines = raw.split('\n');
  const parts = [];
  let listItems = [];
  let listType = null;

  const flushList = () => {
    if (listItems.length) {
      parts.push(`<${listType}>` + listItems.map(t => `<li>${t}</li>`).join('') + `</${listType}>`);
      listItems = [];
      listType = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith('* ')) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(renderInline(line.slice(2)));
    } else if (/^\d+\) /.test(line)) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(renderInline(line.replace(/^\d+\) /, '')));
    } else {
      flushList();
      parts.push(renderInline(line));
    }
  }
  flushList();

  const isBlock = s => s.startsWith('<ul>') || s.startsWith('<ol>');
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && !isBlock(parts[i - 1]) && !isBlock(parts[i])) html += '<br>';
    html += parts[i];
  }
  return html;
}

const _isSeparator = line => /^-{2,}\s*$/.test(line);

// Splits raw text into two columns at the "--"-or-more line closest to the
// character midpoint. All separator lines are stripped from both halves.
// Falls back to a single column if no separator is present.
function render2Col(raw) {
  if (!raw.trim()) return '';
  const lines = raw.split('\n');
  const mid = raw.length / 2;
  let splitIdx = -1;
  let bestDist = Infinity;
  let charOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (_isSeparator(lines[i])) {
      const dist = Math.abs(charOffset + lines[i].length / 2 - mid);
      if (dist < bestDist) { bestDist = dist; splitIdx = i; }
    }
    charOffset += lines[i].length + 1;
  }
  // Render a half-column: trim trailing separators/blanks, split remaining
  // --- lines into segments, render each with renderFormatted, join with <hr>.
  const renderHalf = arr => {
    const lines = [...arr];
    while (lines.length && (lines[lines.length - 1] === '' || _isSeparator(lines[lines.length - 1]))) lines.pop();
    const segments = [];
    let cur = [];
    for (const line of lines) {
      if (_isSeparator(line)) { segments.push(cur); cur = []; }
      else cur.push(line);
    }
    segments.push(cur);
    return segments.map(s => renderFormatted(s.join('\n'))).join('<hr class="col-rule">');
  };
  if (splitIdx === -1) {
    return `<div class="two-col-single">${renderHalf(lines)}</div>`;
  }
  return `<div class="two-col-left">${renderHalf(lines.slice(0, splitIdx))}</div>` +
    `<div class="two-col-right">${renderHalf(lines.slice(splitIdx + 1))}</div>`;
}

// Renders raw text into a display element.
// For data-formula fields the formula is evaluated and only the result is shown.
// For data-2col fields the text is split into two columns at the nearest "--" line.
// For all other fields markdown links and bullet points are rendered.
function updateDisplay(displayEl, rawText) {
  const inputId = displayEl.id.replace(/-display$/, "");
  const inputEl = document.getElementById(inputId);
  if (inputEl && inputEl.hasAttribute("data-formula")) {
    displayEl.textContent = renderFormula(rawText);
  } else if (inputEl && inputEl.hasAttribute("data-2col")) {
    displayEl.innerHTML = render2Col(rawText);
  } else {
    displayEl.innerHTML = renderFormatted(rawText);
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
  const syntaxHint = document.getElementById("edit-dialog-syntax-hint");
  if (inputEl.hasAttribute("data-formula")) {
    syntaxHint.textContent = "Formulas: 1 + 2 * 3 · Comments: {your note here}";
  } else if (inputEl.hasAttribute("data-formattable")) {
    let hint = `${_modKey}+K to insert link · [label](url) · **bold** · _italic_ · * bullet · 1) numbered`;
    if (inputEl.hasAttribute("data-2col")) hint += " · --- to split entries";
    syntaxHint.textContent = hint;
  } else {
    syntaxHint.textContent = "";
  }
  document.getElementById("edit-dialog").classList.remove("hidden");
  requestAnimationFrame(() => { ta.focus(); });
}

// Closes the edit dialog saving the current textarea value (Done button / backdrop / Cmd+Enter).
function closeEditDialog() {
  if (_editDialogField) {
    const ta = document.getElementById("edit-dialog-textarea");
    if (ta.value !== _editDialogOriginalValue)
      _undoStack.push({ field: _editDialogField, display: _editDialogDisplay, value: _editDialogOriginalValue });
    _editDialogField.value = ta.value;
    updateDisplay(_editDialogDisplay, ta.value);
    autosave();
  }
  document.getElementById("edit-dialog").classList.add("hidden");
  document.getElementById("edit-dialog-syntax-hint").textContent = "";
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
  document.getElementById("edit-dialog-syntax-hint").textContent = "";
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

// Sizes a bio header display span (and its paired hidden input) to fit a given string.
// Measures font and padding from the display span, which is always visible, then
// applies the same width to both elements so they stay in sync.
function fitInput(el, sizingText) {
  const display = document.getElementById(el.id + "-display");
  const measureEl = display || el;
  const ctx = _measureCanvas.getContext("2d");
  ctx.font = getComputedStyle(measureEl).font;
  const textW = ctx.measureText(sizingText).width;
  const cs = getComputedStyle(measureEl);
  const padW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4;
  const w = (textW + padW) + "px";
  if (display) display.style.width = w;
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
    ["dialog_bg", "--dialog-bg"],
    ["card_bg", "--card-bg"],
    ["tag_bg", "--tag-bg"],
    ["header_font", "--header-font"],
    ["secondary_font_color", "--secondary-font-color"],
    ["button_font_color", "--button-font-color"],
    ["button_bg", "--button-bg"],
    ["main_font", "--main-font"],
    ["primary_font_color", "--primary-font-color"],
  ];
  const px = [
    ["header_font_size", "--header-font-size"],
    ["main_font_size", "--main-font-size"],
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
  if (cfg.subclass_sizing_text)
    fitInput(document.getElementById("subclass"), cfg.subclass_sizing_text);
  if (cfg.race_line_sizing_text) {
    fitInput(document.getElementById("race"), cfg.race_line_sizing_text);
    fitInput(document.getElementById("background"), cfg.race_line_sizing_text);
    fitInput(document.getElementById("alignment"), cfg.race_line_sizing_text);
  }
  if (cfg.physical_measureable_sizing_text) {
    fitInput(document.getElementById("age"), cfg.physical_measureable_sizing_text);
    fitInput(document.getElementById("height"), cfg.physical_measureable_sizing_text);
    fitInput(document.getElementById("weight"), cfg.physical_measureable_sizing_text);
    fitInput(document.getElementById("size-category"), cfg.physical_measureable_sizing_text);
  }
  if (cfg.physical_description_sizing_text) {
    fitInput(document.getElementById("eyes"), cfg.physical_description_sizing_text);
    fitInput(document.getElementById("hair"), cfg.physical_description_sizing_text);
    fitInput(document.getElementById("skin"), cfg.physical_description_sizing_text);
  }
  if (cfg.level_sizing_text)
    fitInput(document.getElementById("level"), cfg.level_sizing_text);
  if (cfg.hd_sizing_text)
    fitInput(document.getElementById("hd"), cfg.hd_sizing_text);
  if (cfg.experience_sizing_text)
    fitInput(document.getElementById("experience"), cfg.experience_sizing_text);
  const bioRows = document.getElementById("bio-rows");
  bioRows.style.maxWidth = bioRows.offsetWidth + "px";
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
  const subclassRaw = character.bio?.subclass ?? "";
  const levelRaw = character.bio?.level ?? "";
  const hdRaw = character.bio?.hd ?? "";
  const experienceRaw = character.bio?.experience ?? "";
  const raceRaw = character.bio?.race ?? "";
  const backgroundRaw = character.bio?.background ?? "";
  const alignmentRaw = character.bio?.alignment ?? "";
  const ageRaw = character.bio?.age ?? "";
  const heightRaw = character.bio?.height ?? "";
  const weightRaw = character.bio?.weight ?? "";
  const sizeCategoryRaw = character.bio?.size_category ?? "";
  const eyesRaw = character.bio?.eyes ?? "";
  const hairRaw = character.bio?.hair ?? "";
  const skinRaw = character.bio?.skin ?? "";
  const personalityTraitsRaw = character.bio?.personality_traits ?? "";
  const idealsRaw = character.bio?.ideals ?? "";
  const backgroundHistoryRaw = character.bio?.background_history ?? "";
  const bondsRaw = character.bio?.bonds ?? "";
  const traitsRaw = character.bio?.traits ?? "";
  document.getElementById("player-name").value = playerRaw;
  document.getElementById("character-name").value = charRaw;
  document.getElementById("class").value = classRaw;
  document.getElementById("subclass").value = subclassRaw;
  document.getElementById("level").value = levelRaw;
  document.getElementById("hd").value = hdRaw;
  document.getElementById("experience").value = experienceRaw;
  document.getElementById("race").value = raceRaw;
  document.getElementById("background").value = backgroundRaw;
  document.getElementById("alignment").value = alignmentRaw;
  document.getElementById("age").value = ageRaw;
  document.getElementById("height").value = heightRaw;
  document.getElementById("weight").value = weightRaw;
  document.getElementById("size-category").value = sizeCategoryRaw;
  document.getElementById("eyes").value = eyesRaw;
  document.getElementById("hair").value = hairRaw;
  document.getElementById("skin").value = skinRaw;
  document.getElementById("personality-traits").value = personalityTraitsRaw;
  document.getElementById("ideals").value = idealsRaw;
  document.getElementById("background-history").value = backgroundHistoryRaw;
  document.getElementById("bonds").value = bondsRaw;
  document.getElementById("traits").value = traitsRaw;
  updateDisplay(document.getElementById("player-name-display"), playerRaw);
  updateDisplay(document.getElementById("character-name-display"), charRaw);
  updateDisplay(document.getElementById("class-display"), classRaw);
  updateDisplay(document.getElementById("subclass-display"), subclassRaw);
  updateDisplay(document.getElementById("level-display"), levelRaw);
  updateDisplay(document.getElementById("hd-display"), hdRaw);
  updateDisplay(document.getElementById("experience-display"), experienceRaw);
  updateDisplay(document.getElementById("race-display"), raceRaw);
  updateDisplay(document.getElementById("background-display"), backgroundRaw);
  updateDisplay(document.getElementById("alignment-display"), alignmentRaw);
  updateDisplay(document.getElementById("age-display"), ageRaw);
  updateDisplay(document.getElementById("height-display"), heightRaw);
  updateDisplay(document.getElementById("weight-display"), weightRaw);
  updateDisplay(document.getElementById("size-category-display"), sizeCategoryRaw);
  updateDisplay(document.getElementById("eyes-display"), eyesRaw);
  updateDisplay(document.getElementById("hair-display"), hairRaw);
  updateDisplay(document.getElementById("skin-display"), skinRaw);
  updateDisplay(document.getElementById("personality-traits-display"), personalityTraitsRaw);
  updateDisplay(document.getElementById("ideals-display"), idealsRaw);
  updateDisplay(document.getElementById("background-history-display"), backgroundHistoryRaw);
  updateDisplay(document.getElementById("bonds-display"), bondsRaw);
  updateDisplay(document.getElementById("traits-display"), traitsRaw);
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
      p.innerHTML = renderFormatted(n);
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
      subclass: document.getElementById("subclass").value,
      level: document.getElementById("level").value,
      hd: document.getElementById("hd").value,
      experience: document.getElementById("experience").value,
      race: document.getElementById("race").value,
      background: document.getElementById("background").value,
      alignment: document.getElementById("alignment").value,
      age: document.getElementById("age").value,
      height: document.getElementById("height").value,
      weight: document.getElementById("weight").value,
      size_category: document.getElementById("size-category").value,
      eyes: document.getElementById("eyes").value,
      hair: document.getElementById("hair").value,
      skin: document.getElementById("skin").value,
      personality_traits: document.getElementById("personality-traits").value,
      ideals: document.getElementById("ideals").value,
      bonds: document.getElementById("bonds").value,
      traits: document.getElementById("traits").value,
      background_history: document.getElementById("background-history").value,
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
// data-formattable element, provided text is selected.
document.querySelectorAll("[data-formattable]").forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openLinkDialog(el); }
  });
});

// Edit dialog: Done button, Escape key, and textarea sync.
document.getElementById("edit-dialog-done-btn").addEventListener("click", closeEditDialog);
document.getElementById("edit-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("edit-dialog-box").contains(e.target)) cancelEditDialog();
});
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
document.getElementById("link-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) applyLink(document.getElementById("link-url").value.trim());
  if (e.key === "Escape") closeLinkDialog(true);
});
document.getElementById("link-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("link-dialog-box").contains(e.target)) closeLinkDialog(true);
});
document.getElementById("link-dialog").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLinkDialog(true);
});

// Undo the last dialog save with Cmd/Ctrl+Z (suppressed while the dialog is open
// so native textarea undo still works during editing).
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "z") return;
  if (!document.getElementById("edit-dialog").classList.contains("hidden")) return;
  if (!_undoStack.length) return;
  e.preventDefault();
  const { field, display, value } = _undoStack.pop();
  field.value = value;
  updateDisplay(display, value);
  autosave();
});

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
  e.preventDefault();
  document.getElementById("save-btn").click();
});

// Autosave bio fields on every keystroke (these inputs are normally hidden behind
// their display spans, but they remain the source of truth for collectCharacter).
document.getElementById("player-name").addEventListener("input", autosave);
document.getElementById("character-name").addEventListener("input", autosave);
document.getElementById("class").addEventListener("input", autosave);
document.getElementById("subclass").addEventListener("input", autosave);
document.getElementById("race").addEventListener("input", autosave);
document.getElementById("background").addEventListener("input", autosave);
document.getElementById("alignment").addEventListener("input", autosave);
document.getElementById("age").addEventListener("input", autosave);
document.getElementById("height").addEventListener("input", autosave);
document.getElementById("weight").addEventListener("input", autosave);
document.getElementById("size-category").addEventListener("input", autosave);
document.getElementById("eyes").addEventListener("input", autosave);
document.getElementById("hair").addEventListener("input", autosave);
document.getElementById("skin").addEventListener("input", autosave);
document.getElementById("personality-traits").addEventListener("input", autosave);
document.getElementById("level").addEventListener("input", autosave);
document.getElementById("hd").addEventListener("input", autosave);
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

document.getElementById("edit-dialog-hint").textContent = `${_modKey}+↵ to save · Esc to cancel`;
document.getElementById("link-dialog-hint").textContent = `${_modKey}+↵ to save · Esc to cancel`;

load();
