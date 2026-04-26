import { escHtml, renderFormula, renderFormatted, render2Col, reorderItem, parseFormulaRefs, validateFormula, DependencyGraph } from './logic.js';

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

// ── Formula dependency system ──────────────────────────────────────────────
// All valid reference targets built from the HTML at init time ("section.field").
const _allFieldIds = new Set();
// Formula-render fields that have data-field-key in bio/money panels.
const _formulaNodeIds = new Set();
// Dependency graph: u -> v means u's formula references v's computed value.
const _formulaGraph = new DependencyGraph();
// Cached computed display value for each formula node ("section.field" -> string).
const _computedValues = {};


// HTML data-attributes and the .dialog-hint / .card-movable classes are documented
// in AGENTS.md → "Data-attributes". Keep the two in sync.



// Render-mode registry: single source of truth for how a data-field-render value
// renders its display and whether Cmd+K opens the link dialog while editing.
// To add a render mode: add one entry here and add the value to the set
// accepted by data-field-render in index.html. No other changes needed.
const RENDER_MODES = {
  formatted: {
    render: (el, raw) => { el.innerHTML = renderFormatted(raw); },
    linkShortcut: true,
  },
  "formatted-multi-value": {
    render: (el, raw) => { el.innerHTML = render2Col(raw); },
    linkShortcut: true,
  },
  formula: {
    render: (el, raw) => { el.textContent = renderFormula(raw, _buildFieldValues()); },
    linkShortcut: false,
  },
};

function renderMode(el) {
  return el ? RENDER_MODES[el.dataset.fieldRender] : null;
}

function fieldTypeLabel(el) {
  const mode = el?.dataset?.fieldRender;
  if (mode === "formatted-multi-value") return "Type: formatted multi-value";
  if (mode === "formula") return "Type: formula";
  return "Type: formatted";
}

// Renders raw text into a display element using the paired input's render mode.
function updateDisplay(displayEl, rawText) {
  const inputId = displayEl.id.replace(/-display$/, "");
  const inputEl = document.getElementById(inputId);
  const mode = renderMode(inputEl);
  displayEl.classList.toggle("field-display-2col", inputEl?.dataset.layout === "2col");
  (mode ?? RENDER_MODES.formatted).render(displayEl, rawText);
}

// ── Formula system helpers ─────────────────────────────────────────────────

// Returns the section.field node ID for an input element, or null if not a bio/money/stats field.
function _getNodeId(inputEl) {
  const key = inputEl?.dataset?.fieldKey;
  if (!key) return null;
  if (document.getElementById("panel-bio").contains(inputEl)) return `bio.${key}`;
  if (document.getElementById("money-row").contains(inputEl)) return `money.${key}`;
  if (document.getElementById("panel-stats").contains(inputEl)) return `stats.${key}`;
  return null;
}

// Returns the raw formula string stored in the DOM input for a nodeId.
function _getRawFieldValue(section, field) {
  if (section === "bio") {
    return document.querySelector(`#panel-bio [data-field-key="${field}"]`)?.value ?? "";
  }
  if (section === "money") {
    return document.querySelector(`#money-row [data-field-key="${field}"]`)?.value ?? "";
  }
  if (section === "stats") {
    return document.querySelector(`#panel-stats [data-field-key="${field}"]`)?.value ?? "";
  }
  return "";
}

// Returns a snapshot of current field values for formula reference resolution.
// Formula nodes use their cached computed value; all others use raw DOM value.
function _buildFieldValues() {
  const values = {};
  for (const nodeId of _allFieldIds) {
    const [section, field] = nodeId.split(".");
    values[nodeId] = _formulaNodeIds.has(nodeId)
      ? (_computedValues[nodeId] ?? "0")
      : _getRawFieldValue(section, field);
  }
  return values;
}

// Returns the display element for a formula node, or null.
function _getFormulaNodeDisplay(nodeId) {
  const [section, field] = nodeId.split(".");
  const container = section === "bio" ? "#panel-bio" : section === "stats" ? "#panel-stats" : "#money-row";
  const inputEl = document.querySelector(`${container} [data-field-key="${field}"]`);
  return inputEl ? document.getElementById(inputEl.id + "-display") : null;
}

// Recomputes one formula node's value and updates its display element.
function _recomputeFormulaNode(nodeId) {
  const [section, field] = nodeId.split(".");
  const raw = _getRawFieldValue(section, field);
  const computed = renderFormula(raw, _buildFieldValues());
  _computedValues[nodeId] = computed;
  const displayEl = _getFormulaNodeDisplay(nodeId);
  if (displayEl) displayEl.textContent = computed;
}

// Recomputes all formula nodes in dependency order (dependencies before dependents).
function _recomputeAllFormulaNodes() {
  const order = _formulaGraph.topoSort(_formulaNodeIds);
  for (const nodeId of order) {
    _recomputeFormulaNode(nodeId);
  }
  // Any nodes not reached by topoSort (isolated nodes) are still recomputed.
  for (const nodeId of _formulaNodeIds) {
    if (!order.includes(nodeId)) _recomputeFormulaNode(nodeId);
  }
  _recomputeCalcFields();
}

// ── Calculated ability fields ──────────────────────────────────────────────

const _ATTR_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

// Builds a roll formula string for use in virtual tabletop dice rollers.
// extraDice: string[] of additional dice (e.g. ["1d6", "1d8"])
// bonuses: number[] summed into a single signed modifier
// advStatus: "adv" → 2d20kh1, "dis" → 2d20kl1, "none" → 1d20
function D20Roll(extraDice, bonuses, advStatus) {
  const d20 = advStatus === "adv" ? "2d20kh1" : advStatus === "dis" ? "2d20kl1" : "1d20";
  const total = bonuses.reduce((a, b) => a + b, 0);
  const parts = [d20, ...extraDice.map(d => `+ ${d}`)];
  parts.push(total >= 0 ? `+ ${total}` : `- ${Math.abs(total)}`);
  return `/r ${parts.join(" ")}`;
}

// Recomputes the derived Mod, Ability Check, and Save display spans for each ability.
// Called after every formula recomputation and on save-prof checkbox change.
function _recomputeCalcFields() {
  const profBonus = parseFloat(_computedValues["stats.proficiency_bonus"] ?? "") || 0;
  const saveBonus = parseFloat(_computedValues["stats.save_bonus"] ?? "") || 0;

  for (const attr of _ATTR_KEYS) {
    const valStr = _computedValues[`stats.${attr}`] ?? "";
    const modEl = document.getElementById(`stats-${attr}-mod`);
    const acEl = document.getElementById(`stats-${attr}-ability-check`);
    const saveEl = document.getElementById(`stats-${attr}-save`);

    if (!valStr) {
      if (modEl) modEl.textContent = "";
      if (acEl) acEl.textContent = "";
      if (saveEl) saveEl.textContent = "";
      continue;
    }

    const mod = Math.floor((parseFloat(valStr) - 10) / 2);
    const saveProfCb = document.getElementById(`stats-${attr}-save-prof`);
    const profBonusSave = saveProfCb?.checked ? profBonus : 0;

    if (modEl) modEl.textContent = String(mod);
    if (acEl) acEl.textContent = D20Roll([], [mod], "none");
    if (saveEl) saveEl.textContent = D20Roll([], [mod, profBonusSave, saveBonus], "none");
  }
}

// Updates the formula graph edges for nodeId based on its new raw formula,
// then recomputes all formula nodes in topological order.
function _applyFormulaChange(nodeId, newRaw) {
  _formulaGraph.clearDependencies(nodeId);
  for (const { section, field } of parseFormulaRefs(newRaw)) {
    const depId = `${section}.${field}`;
    if (_formulaNodeIds.has(depId)) _formulaGraph.addEdge(nodeId, depId);
  }
  _recomputeAllFormulaNodes();
}

// Initialises the formula system: builds field-id sets, graph edges, and computed values.
// Called once from render() after populateFields has set all DOM input values.
function _initFormulaSystem() {
  _allFieldIds.clear();
  _formulaNodeIds.clear();

  document.querySelectorAll("#panel-bio [data-field-key]").forEach(el => {
    const id = `bio.${el.dataset.fieldKey}`;
    _allFieldIds.add(id);
    if (el.dataset.fieldRender === "formula") _formulaNodeIds.add(id);
  });
  document.querySelectorAll("#money-row [data-field-key]").forEach(el => {
    const id = `money.${el.dataset.fieldKey}`;
    _allFieldIds.add(id);
    if (el.dataset.fieldRender === "formula") _formulaNodeIds.add(id);
  });
  document.querySelectorAll("#panel-stats [data-field-render='formula'][data-field-key]").forEach(el => {
    const id = `stats.${el.dataset.fieldKey}`;
    _allFieldIds.add(id);
    _formulaNodeIds.add(id);
  });

  // Build graph edges from current formula values.
  for (const nodeId of _formulaNodeIds) {
    const [section, field] = nodeId.split(".");
    const raw = _getRawFieldValue(section, field);
    _formulaGraph.clearDependencies(nodeId);
    for (const { section: s, field: f } of parseFormulaRefs(raw)) {
      const depId = `${s}.${f}`;
      if (_formulaNodeIds.has(depId)) _formulaGraph.addEdge(nodeId, depId);
    }
  }

  _recomputeAllFormulaNodes();

  // Annotate formula node display spans so the CSS hover tooltip can show the reference.
  for (const nodeId of _formulaNodeIds) {
    const displayEl = _getFormulaNodeDisplay(nodeId);
    if (displayEl) displayEl.dataset.formulaRef = nodeId;
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
  ta.dataset.fieldRender = inputEl.dataset.fieldRender ?? "formatted";
  document.getElementById("edit-dialog-field-type").textContent = fieldTypeLabel(inputEl);
  document.getElementById("edit-dialog").classList.remove("hidden");
  requestAnimationFrame(() => { ta.focus(); });
}

// Closes the edit dialog saving the current textarea value (Done button / backdrop / Cmd+Enter).
// For formula fields: validates first and blocks close on error.
function closeEditDialog() {
  if (_editDialogField) {
    const ta = document.getElementById("edit-dialog-textarea");
    const newValue = ta.value;

    if (_editDialogField.dataset.fieldRender === "formula") {
      const nodeId = _getNodeId(_editDialogField);
      if (nodeId) {
        const err = validateFormula(newValue, _formulaNodeIds, nodeId, _formulaGraph);
        if (err) {
          document.getElementById("edit-dialog-error").textContent = err;
          return;
        }
        document.getElementById("edit-dialog-error").textContent = "";
      }
    }

    if (newValue !== _editDialogOriginalValue) {
      const f = _editDialogField, d = _editDialogDisplay, v = _editDialogOriginalValue;
      _undoStack.push({
        undo: () => {
          f.value = v;
          if (f.dataset.fieldRender === "formula") {
            const nid = _getNodeId(f);
            if (nid) _applyFormulaChange(nid, v);
            else _recomputeAllFormulaNodes();
          } else {
            updateDisplay(d, v);
            _recomputeAllFormulaNodes();
          }
          autosave();
        },
      });
    }

    _editDialogField.value = newValue;
    if (_editDialogField.dataset.fieldRender === "formula") {
      const nodeId = _getNodeId(_editDialogField);
      if (nodeId) _applyFormulaChange(nodeId, newValue);
      else _recomputeAllFormulaNodes();
    } else {
      updateDisplay(_editDialogDisplay, newValue);
      _recomputeAllFormulaNodes();
    }
    autosave();
  }
  document.getElementById("edit-dialog").classList.add("hidden");
  document.getElementById("edit-dialog-field-type").textContent = "";
  document.getElementById("edit-dialog-error").textContent = "";
  _editDialogField = null;
  _editDialogDisplay = null;
  _editDialogOriginalValue = null;
}

// Closes the edit dialog restoring the original value (Escape key).
function cancelEditDialog() {
  if (_editDialogField && _editDialogOriginalValue !== null) {
    _editDialogField.value = _editDialogOriginalValue;
    if (_editDialogField.dataset.fieldRender === "formula") {
      const nodeId = _getNodeId(_editDialogField);
      if (nodeId) _applyFormulaChange(nodeId, _editDialogOriginalValue);
      else _recomputeAllFormulaNodes();
    } else {
      updateDisplay(_editDialogDisplay, _editDialogOriginalValue);
      _recomputeAllFormulaNodes();
    }
    autosave();
  }
  document.getElementById("edit-dialog").classList.add("hidden");
  document.getElementById("edit-dialog-field-type").textContent = "";
  document.getElementById("edit-dialog-error").textContent = "";
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
  (display ?? el).style.width = w;
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
    ["card_hover_bg", "--card-hover-bg"],
    ["tag_bg", "--tag-bg"],
    ["header_font", "--header-font"],
    ["secondary_font_color", "--secondary-font-color"],
    ["button_font_color", "--button-font-color"],
    ["button_bg", "--button-bg"],
    ["main_font", "--main-font"],
    ["primary_font_color", "--primary-font-color"],
    ["sep_color", "--sep-color"],
    ["dialog_error_color", "--dialog-error-color"],
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

  _cfg = cfg;
  document.querySelectorAll("[data-sizing-key]").forEach(el => {
    const key = el.dataset.sizingKey;
    if (cfg[key]) fitInput(el, cfg[key]);
  });
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

// Populates every data-field-key input inside container from obj[key]; also
// refreshes any paired -display span.
function populateFields(container, obj) {
  container.querySelectorAll("[data-field-key]").forEach(el => {
    const raw = obj?.[el.dataset.fieldKey] ?? "";
    if (el.type === "checkbox") {
      el.checked = raw === true || raw === "true";
    } else {
      el.value = raw;
      const display = document.getElementById(el.id + "-display");
      if (display) updateDisplay(display, raw);
    }
  });
}

// Reads every data-field-key input inside container into a plain object.
function collectFields(container) {
  const obj = {};
  container.querySelectorAll("[data-field-key]").forEach(el => {
    if (el.type === "checkbox") {
      obj[el.dataset.fieldKey] = el.checked;
    } else {
      obj[el.dataset.fieldKey] = el.value;
    }
  });
  return obj;
}

function render() {
  populateFields(document.getElementById("panel-bio"), character.bio);
  populateFields(document.getElementById("money-row"), character.money);
  populateFields(document.getElementById("panel-stats"), character.stats);
  _initFormulaSystem();
  renderFeats();
  renderGear();
  renderNotes();
  renderLevelLog();
}

// Converts legacy { tags, notes: [...] } format to { tags, text }.
function normalizeNote(note) {
  if (note.text !== undefined) return note;
  return { tags: note.tags ?? [], text: (note.notes ?? []).join("\n") };
}

// Rebuilds the #notes-list DOM from character.campaign_notes.
// Each note becomes a clickable, draggable card with tag chips and rendered text.
let _dragIndex = null;
let _activeTagFilters = new Set();

function renderTagFilter() {
  const container = document.getElementById("note-tag-filter");
  container.innerHTML = "";
  const allTags = [...new Set(
    (character.campaign_notes ?? []).flatMap(n => n.tags ?? [])
  )].sort();
  // Drop filters for tags that no longer exist in any note.
  for (const t of _activeTagFilters) { if (!allTags.includes(t)) _activeTagFilters.delete(t); }
  allTags.forEach(tag => {
    const chip = document.createElement("span");
    chip.className = "tag-filter-chip" + (_activeTagFilters.has(tag) ? " active" : "");
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      if (_activeTagFilters.has(tag)) { _activeTagFilters.delete(tag); } else { _activeTagFilters.add(tag); }
      renderNotes();
    });
    container.appendChild(chip);
  });
  if (_activeTagFilters.size > 0) {
    const clearBtn = document.createElement("button");
    clearBtn.className = "btn-clear-filter";
    clearBtn.textContent = "Show All";
    clearBtn.addEventListener("click", () => { _activeTagFilters.clear(); renderNotes(); });
    container.appendChild(clearBtn);
  }
}

// ── Feats & Features ───────────────────────────────────────────────────────

let _featDialogIndex = null;
let _featDragIndex = null;

function renderFeats() {
  character.feats_features = character.feats_features ?? [];
  const left = document.getElementById("feats-left");
  const right = document.getElementById("feats-right");
  left.innerHTML = "";
  right.innerHTML = "";
  const feats = character.feats_features;
  const half = Math.ceil(feats.length / 2);
  [feats.slice(0, half), feats.slice(half)].forEach((group, side) => {
    const col = side === 0 ? left : right;
    const baseIdx = side === 0 ? 0 : half;
    group.forEach((feat, j) => {
      const idx = baseIdx + j;
      const card = document.createElement("div");
      card.className = "feat-card card-movable";

      let _dragged = false;
      card.addEventListener("click", () => { if (_dragged) { _dragged = false; return; } openFeatDialog(idx); });

      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        _featDragIndex = idx;
        _dragged = true;
        e.dataTransfer.effectAllowed = "move";
        requestAnimationFrame(() => card.classList.add("dragging"));
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        document.querySelectorAll(".feat-card").forEach(c => c.classList.remove("drag-above", "drag-below"));
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".feat-card").forEach(c => c.classList.remove("drag-above", "drag-below"));
        const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
        card.classList.add(e.clientY < mid ? "drag-above" : "drag-below");
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("drag-above", "drag-below");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-above", "drag-below");
        if (_featDragIndex === null || _featDragIndex === idx) return;
        const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
        const isAbove = e.clientY < mid;
        character.feats_features = reorderItem(character.feats_features, _featDragIndex, idx, isAbove);
        _featDragIndex = null;
        renderFeats();
        autosave();
      });

      RENDER_MODES.formatted.render(card, feat.description ?? "");
      col.appendChild(card);
    });
  });
}

function openFeatDialog(index) {
  _featDialogIndex = index;
  const feat = index === null ? { description: "" } : character.feats_features[index];
  const ta = document.getElementById("feat-dialog-text");
  ta.value = feat.description ?? "";
  document.getElementById("feat-dialog-delete-btn").classList.toggle("hidden", index === null);
  document.getElementById("feat-dialog").classList.remove("hidden");
  requestAnimationFrame(() => ta.focus());
}

function closeFeatDialog() {
  const description = document.getElementById("feat-dialog-text").value;
  character.feats_features = character.feats_features ?? [];
  const prev = character.feats_features.map(f => ({ ...f }));
  if (_featDialogIndex === null) {
    character.feats_features.push({ description });
  } else {
    character.feats_features[_featDialogIndex] = { description };
  }
  _undoStack.push({ undo: () => { character.feats_features = prev; renderFeats(); autosave(); } });
  document.getElementById("feat-dialog").classList.add("hidden");
  _featDialogIndex = null;
  renderFeats();
  autosave();
}

function cancelFeatDialog() {
  document.getElementById("feat-dialog").classList.add("hidden");
  _featDialogIndex = null;
}

function deleteFeatItem() {
  if (_featDialogIndex === null) return;
  const prev = character.feats_features.map(f => ({ ...f }));
  character.feats_features.splice(_featDialogIndex, 1);
  _undoStack.push({ undo: () => { character.feats_features = prev; renderFeats(); autosave(); } });
  cancelFeatDialog();
  renderFeats();
  autosave();
}

function renderNotes() {
  character.campaign_notes = (character.campaign_notes ?? []).map(normalizeNote);
  const list = document.getElementById("notes-list");
  list.innerHTML = "";
  const visible = character.campaign_notes
    .map((note, idx) => ({ note, idx }))
    .filter(({ note }) =>
      _activeTagFilters.size === 0 || (note.tags ?? []).some(t => _activeTagFilters.has(t))
    );
  visible.forEach(({ note, idx }) => {
    const card = document.createElement("div");
    card.className = "note-card card-movable";

    // Suppress click when the mouse-up was the end of a drag, not a tap.
    let _dragged = false;
    card.addEventListener("click", () => { if (_dragged) { _dragged = false; return; } openNoteDialog(idx); });

    // Drag-and-drop reordering. idx is the actual index in character.campaign_notes.
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      _dragIndex = idx;
      _dragged = true;
      e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => card.classList.add("dragging"));
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      list.querySelectorAll(".note-card").forEach((c) => c.classList.remove("drag-above", "drag-below"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.querySelectorAll(".note-card").forEach((c) => c.classList.remove("drag-above", "drag-below"));
      const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
      card.classList.add(e.clientY < mid ? "drag-above" : "drag-below");
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-above", "drag-below");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-above", "drag-below");
      if (_dragIndex === null || _dragIndex === idx) return;
      const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
      const isAbove = e.clientY < mid;
      character.campaign_notes = reorderItem(character.campaign_notes, _dragIndex, idx, isAbove);
      _dragIndex = null;
      renderNotes();
      autosave();
    });

    const tagsRow = document.createElement("div");
    tagsRow.className = "tags-row";
    (note.tags ?? []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tagsRow.appendChild(chip);
    });
    card.appendChild(tagsRow);

    const textDiv = document.createElement("div");
    textDiv.className = "note-entry";
    RENDER_MODES.formatted.render(textDiv, note.text ?? "");
    card.appendChild(textDiv);

    list.appendChild(card);
  });
  renderTagFilter();
}

// ── Note dialog ────────────────────────────────────────────────────────────

let _noteDialogIndex = null;
let _levelLogDialogIndex = null;
let _gearDialogIndex = null;
let _cfg = {};

function openNoteDialog(index) {
  _noteDialogIndex = index;
  const note = index === null ? { tags: [], text: "" } : character.campaign_notes[index];
  const dialog = document.getElementById("note-dialog");
  populateFields(dialog, note);
  document.getElementById("note-dialog-tags").value = (note.tags ?? []).join(", ");
  document.getElementById("note-dialog-delete-btn").classList.toggle("hidden", index === null);
  dialog.classList.remove("hidden");
  requestAnimationFrame(() => { document.getElementById("note-dialog-text").focus(); });
}

function closeNoteDialog() {
  const dialog = document.getElementById("note-dialog");
  const rawTags = document.getElementById("note-dialog-tags").value;
  const tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length === 0) tags.push("general");
  const note = { ...collectFields(dialog), tags };
  character.campaign_notes = character.campaign_notes ?? [];
  const previousNotes = character.campaign_notes.map((n) => ({ ...n, tags: [...n.tags] }));
  if (_noteDialogIndex === null) {
    character.campaign_notes.push(note);
  } else {
    character.campaign_notes[_noteDialogIndex] = note;
  }
  _undoStack.push({ undo: () => { character.campaign_notes = previousNotes; renderNotes(); autosave(); } });
  document.getElementById("note-dialog").classList.add("hidden");
  _noteDialogIndex = null;
  renderNotes();
  autosave();
}

function cancelNoteDialog() {
  document.getElementById("note-dialog").classList.add("hidden");
  _noteDialogIndex = null;
}

function deleteNoteItem() {
  if (_noteDialogIndex === null) return;
  const previousNotes = character.campaign_notes.map((n) => ({ ...n, tags: [...n.tags] }));
  character.campaign_notes.splice(_noteDialogIndex, 1);
  _undoStack.push({ undo: () => { character.campaign_notes = previousNotes; renderNotes(); autosave(); } });
  cancelNoteDialog();
  renderNotes();
  autosave();
}

// ── Level log ──────────────────────────────────────────────────────────────

function renderLevelLog() {
  character.level_log = character.level_log ?? [];
  const tbody = document.getElementById("level-log-tbody");
  tbody.innerHTML = "";
  character.level_log.forEach((entry, i) => {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => openLevelLogDialog(i));
    const tdLevel = document.createElement("td");
    tdLevel.textContent = i + 1;
    const tdClass = document.createElement("td");
    RENDER_MODES.formatted.render(tdClass, entry.class ?? "");
    const tdDetails = document.createElement("td");
    RENDER_MODES.formatted.render(tdDetails, entry.details ?? "");
    tr.appendChild(tdLevel);
    tr.appendChild(tdClass);
    tr.appendChild(tdDetails);
    tbody.appendChild(tr);
  });
}

function openLevelLogDialog(index) {
  _levelLogDialogIndex = index;
  const entry = index === null
    ? { class: "", details: "" }
    : character.level_log[index];
  const dialog = document.getElementById("level-log-dialog");
  populateFields(dialog, entry);
  const level = (index ?? character.level_log.length) + 1;
  document.getElementById("level-log-dialog-level").value = String(level);
  document.getElementById("level-log-dialog-delete-btn").classList.toggle("hidden", index === null);
  dialog.classList.remove("hidden");
  requestAnimationFrame(() => { document.getElementById("level-log-dialog-class").focus(); });
}

function closeLevelLogDialog() {
  const dialog = document.getElementById("level-log-dialog");
  const entry = collectFields(dialog);
  character.level_log = character.level_log ?? [];
  const previousLog = character.level_log.map(e => ({ ...e }));
  if (_levelLogDialogIndex === null) {
    character.level_log.push(entry);
  } else {
    character.level_log[_levelLogDialogIndex] = entry;
  }
  _undoStack.push({ undo: () => { character.level_log = previousLog; renderLevelLog(); autosave(); } });
  document.getElementById("level-log-dialog").classList.add("hidden");
  _levelLogDialogIndex = null;
  renderLevelLog();
  autosave();
}

function cancelLevelLogDialog() {
  document.getElementById("level-log-dialog").classList.add("hidden");
  _levelLogDialogIndex = null;
}

function deleteLevelLogItem() {
  if (_levelLogDialogIndex === null) return;
  const previousLog = character.level_log.map(e => ({ ...e }));
  character.level_log.splice(_levelLogDialogIndex, 1);
  _undoStack.push({ undo: () => { character.level_log = previousLog; renderLevelLog(); autosave(); } });
  cancelLevelLogDialog();
  renderLevelLog();
  autosave();
}

// ── Gear ───────────────────────────────────────────────────────────────────

const GEAR_TYPES = ["Consumable", "Weapons & Armor", "General", "Campaign Specific"];
const GEAR_TYPE_IDS = ["consumable", "weapons-armor", "general", "campaign-specific"];

// Rebuilds the gear section table bodies from character.gear.
// Items are split roughly in half between left and right columns within each type section.
function renderGear() {
  character.gear = character.gear ?? [];
  GEAR_TYPES.forEach((type, ti) => {
    const id = GEAR_TYPE_IDS[ti];
    const indexed = character.gear
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.gear_type === type);
    const half = Math.ceil(indexed.length / 2);
    [indexed.slice(0, half), indexed.slice(half)].forEach((group, side) => {
      const tbody = document.getElementById(`gear-${side === 0 ? "left" : "right"}-${id}`);
      tbody.innerHTML = "";
      group.forEach(({ item, i }) => {
        const tr = document.createElement("tr");
        tr.addEventListener("click", () => openGearDialog(i));
        const tdDesc = document.createElement("td");
        RENDER_MODES.formatted.render(tdDesc, item.description ?? "");
        const tdLoc = document.createElement("td");
        tdLoc.textContent = item.location ?? "";
        const tdWeight = document.createElement("td");
        tdWeight.textContent = renderFormula(item.weight ?? "", _buildFieldValues());
        tr.append(tdDesc, tdLoc, tdWeight);
        tbody.appendChild(tr);
      });
    });
  });
}

// ── Gear dialog ────────────────────────────────────────────────────────────

function openGearDialog(index) {
  _gearDialogIndex = index;
  const item = index === null
    ? { gear_type: "General", description: "", location: "", weight: "" }
    : character.gear[index];
  document.getElementById("gear-dialog-type").value = item.gear_type ?? "General";
  document.getElementById("gear-dialog-location").value = item.location ?? "";
  document.getElementById("gear-dialog-weight").value = item.weight ?? "";
  document.getElementById("gear-dialog-description").value = item.description ?? "";
  document.getElementById("gear-dialog-delete-btn").classList.toggle("hidden", index === null);
  document.getElementById("gear-dialog-field-type").textContent = "Type: formatted";
  document.getElementById("gear-dialog").classList.remove("hidden");
  requestAnimationFrame(() => { document.getElementById("gear-dialog-description").focus(); });
}

function closeGearDialog() {
  const weightRaw = document.getElementById("gear-dialog-weight").value;
  const weightErr = validateFormula(weightRaw, _formulaNodeIds);
  if (weightErr) {
    document.getElementById("gear-dialog-error").textContent = weightErr;
    return;
  }
  document.getElementById("gear-dialog-error").textContent = "";

  const entry = {
    gear_type: document.getElementById("gear-dialog-type").value,
    description: document.getElementById("gear-dialog-description").value,
    location: document.getElementById("gear-dialog-location").value,
    weight: weightRaw,
  };
  character.gear = character.gear ?? [];
  const previousGear = character.gear.map(g => ({ ...g }));
  if (_gearDialogIndex === null) {
    character.gear.push(entry);
  } else {
    character.gear[_gearDialogIndex] = entry;
  }
  _undoStack.push({ undo: () => { character.gear = previousGear; renderGear(); autosave(); } });
  document.getElementById("gear-dialog").classList.add("hidden");
  document.getElementById("gear-dialog-field-type").textContent = "";
  _gearDialogIndex = null;
  renderGear();
  autosave();
}

function cancelGearDialog() {
  document.getElementById("gear-dialog").classList.add("hidden");
  document.getElementById("gear-dialog-field-type").textContent = "";
  document.getElementById("gear-dialog-error").textContent = "";
  _gearDialogIndex = null;
}

function deleteGearItem() {
  if (_gearDialogIndex === null) return;
  const previousGear = character.gear.map(g => ({ ...g }));
  character.gear.splice(_gearDialogIndex, 1);
  _undoStack.push({ undo: () => { character.gear = previousGear; renderGear(); autosave(); } });
  cancelGearDialog();
  renderGear();
  autosave();
}

// Assembles the current character object from live DOM field values.
// Array fields are carried over from character unchanged; bio/money/stats are re-collected from the DOM.
function collectCharacter() {
  return {
    bio: collectFields(document.getElementById("panel-bio")),
    money: collectFields(document.getElementById("money-row")),
    stats: collectFields(document.getElementById("panel-stats")),
    feats_features: character.feats_features ?? [],
    gear: character.gear ?? [],
    campaign_notes: character.campaign_notes ?? [],
    level_log: character.level_log ?? [],
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

// Open the edit dialog when clicking a bio field's paired display span.
// Clicks on rendered links inside the span are ignored so the link can be followed.
document.querySelectorAll("#panel-bio [data-field-key]").forEach((input) => {
  const display = document.getElementById(input.id + "-display");
  if (!display) return;
  display.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    openEditDialog(input, display);
  });
});

// Open the link dialog with cmd-k (Mac) or ctrl-k (Windows/Linux) on any
// element whose render mode supports links. Uses a document-level listener so
// the edit dialog textarea works too: its data-field-render is set dynamically on open.
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "k") return;
  const el = e.target;
  if (!el || !renderMode(el)?.linkShortcut) return;
  e.preventDefault();
  openLinkDialog(el);
});

// Edit dialog: Done button, Escape key, and textarea sync.
document.getElementById("edit-dialog-done-btn").addEventListener("click", closeEditDialog);
document.getElementById("edit-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("edit-dialog-box").contains(e.target)) cancelEditDialog();
});
document.getElementById("edit-dialog").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !_linkDialogOpen) { cancelEditDialog(); e.stopPropagation(); }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { closeEditDialog(); e.stopPropagation(); }
});
document.getElementById("edit-dialog-textarea").addEventListener("input", () => {
  // Sync the textarea's value back to the hidden field input on every keystroke
  // so autosave always reads the correct value even before the dialog is closed.
  if (_editDialogField) {
    _editDialogField.value = document.getElementById("edit-dialog-textarea").value;
    autosave();
    // For non-formula fields: cascade to formula fields that may reference this one.
    // Skip formula fields — their displays are only updated on validated Done.
    if (_editDialogField.dataset.fieldRender !== "formula") {
      _recomputeAllFormulaNodes();
    }
    // Clear any stale formula error as user types.
    document.getElementById("edit-dialog-error").textContent = "";
  }
});

// Link dialog: OK button, Remove button, Cancel button, and keyboard shortcuts.
document.getElementById("link-ok-btn").addEventListener("click", () => {
  applyLink(document.getElementById("link-url").value.trim());
});
document.getElementById("link-remove-btn").addEventListener("click", () => applyLink(""));
document.getElementById("link-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { applyLink(document.getElementById("link-url").value.trim()); e.stopPropagation(); }
  if (e.key === "Escape") { closeLinkDialog(true); e.stopPropagation(); }
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
  if (!document.getElementById("note-dialog").classList.contains("hidden")) return;
  if (!document.getElementById("level-log-dialog").classList.contains("hidden")) return;
  if (!document.getElementById("gear-dialog").classList.contains("hidden")) return;
  if (!_undoStack.length) return;
  e.preventDefault();
  _undoStack.pop().undo();
});

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
  e.preventDefault();
  document.getElementById("save-btn").click();
});

// Autosave bio fields on every keystroke. Dialog fields persist on dialog close
// so they are deliberately excluded here.
document.querySelectorAll("#panel-bio [data-field-key]").forEach(el => {
  el.addEventListener("input", autosave);
});

document.getElementById("add-feat-btn").addEventListener("click", () => openFeatDialog(null));
document.getElementById("add-note-btn").addEventListener("click", () => openNoteDialog(null));
document.getElementById("add-level-log-btn").addEventListener("click", () => openLevelLogDialog(null));
document.getElementById("add-gear-btn").addEventListener("click", () => openGearDialog(null));

// Open the edit dialog when clicking a money field's paired display span.
document.querySelectorAll("#money-row [data-field-key]").forEach((input) => {
  const display = document.getElementById(input.id + "-display");
  if (!display) return;
  display.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    openEditDialog(input, display);
  });
});

// Open the edit dialog when clicking a stats formula field's paired display span.
document.querySelectorAll("#panel-stats [data-field-render='formula'][data-field-key]").forEach((input) => {
  const display = document.getElementById(input.id + "-display");
  if (!display) return;
  display.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    openEditDialog(input, display);
  });
});

// Autosave stats checkboxes on change; also recompute calc fields for save-prof changes.
document.querySelectorAll("#panel-stats input[type='checkbox'][data-field-key]").forEach(cb => {
  cb.addEventListener("change", autosave);
  cb.addEventListener("change", _recomputeCalcFields);
});

// Copy calculated field text to clipboard on click; show a brief "Copied!" toast.
document.querySelectorAll("#panel-stats [data-field-render='calculated']").forEach(span => {
  span.addEventListener("click", () => {
    const text = span.textContent.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const rect = span.getBoundingClientRect();
      const toast = document.createElement("div");
      toast.className = "copy-toast";
      toast.textContent = "Copied!";
      toast.style.left = `${rect.left}px`;
      toast.style.top = `${rect.top > 40 ? rect.top - 28 : rect.bottom + 4}px`;
      document.body.appendChild(toast);
      setTimeout(() => toast.classList.add("fade-out"), 800);
      setTimeout(() => toast.remove(), 1300);
    });
  });
});

// Collapse/expand gear type sections.
document.querySelectorAll(".gear-section-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    btn.closest(".gear-section").classList.toggle("collapsed");
  });
});

// Keep drags alive over the gaps between feat cards (column gap + inter-card gap).
// Without this, releasing over a gap fires dragend with no drop, cancelling the reorder.
document.getElementById("panel-feats").addEventListener("dragover", (e) => e.preventDefault());

// Collapse/expand all gear sections at once.
document.getElementById("toggle-all-gear-btn").addEventListener("click", () => {
  const sections = document.querySelectorAll("#panel-gear .gear-section");
  const anyExpanded = Array.from(sections).some(s => !s.classList.contains("collapsed"));
  sections.forEach(s => s.classList.toggle("collapsed", anyExpanded));
  document.getElementById("toggle-all-gear-btn").textContent = anyExpanded ? "Expand All" : "Collapse All";
});

// Collapse/expand all stats sections at once.
document.getElementById("toggle-all-stats-btn").addEventListener("click", () => {
  const sections = document.querySelectorAll("#panel-stats .gear-section");
  const anyExpanded = Array.from(sections).some(s => !s.classList.contains("collapsed"));
  sections.forEach(s => s.classList.toggle("collapsed", anyExpanded));
  document.getElementById("toggle-all-stats-btn").textContent = anyExpanded ? "Expand All" : "Collapse All";
});

// Level log dialog: Done button, backdrop click, and keyboard shortcuts.
document.getElementById("level-log-dialog-done-btn").addEventListener("click", closeLevelLogDialog);
document.getElementById("level-log-dialog-delete-btn").addEventListener("click", deleteLevelLogItem);
document.getElementById("level-log-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("level-log-dialog-box").contains(e.target)) cancelLevelLogDialog();
});
// Document-level handler so Escape/Cmd+Enter work regardless of focus position,
// including after returning from the edit dialog. Guards ensure it only fires when
// level-log-dialog is the topmost open dialog.
document.addEventListener("keydown", (e) => {
  if (document.getElementById("level-log-dialog").classList.contains("hidden")) return;
  if (!document.getElementById("edit-dialog").classList.contains("hidden")) return;
  if (!document.getElementById("link-dialog").classList.contains("hidden")) return;
  if (e.key === "Escape") { e.preventDefault(); cancelLevelLogDialog(); }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); closeLevelLogDialog(); }
});

// Gear dialog: Done button, Delete button, backdrop click, and keyboard shortcuts.
document.getElementById("gear-dialog-done-btn").addEventListener("click", closeGearDialog);
document.getElementById("gear-dialog-delete-btn").addEventListener("click", deleteGearItem);
document.getElementById("gear-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("gear-dialog-box").contains(e.target)) cancelGearDialog();
});
document.addEventListener("keydown", (e) => {
  if (document.getElementById("gear-dialog").classList.contains("hidden")) return;
  if (!document.getElementById("edit-dialog").classList.contains("hidden")) return;
  if (!document.getElementById("link-dialog").classList.contains("hidden")) return;
  if (e.key === "Escape") { e.preventDefault(); cancelGearDialog(); }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); closeGearDialog(); }
});

// Feat dialog: Done button, backdrop click, and keyboard shortcuts.
document.getElementById("feat-dialog-done-btn").addEventListener("click", closeFeatDialog);
document.getElementById("feat-dialog-delete-btn").addEventListener("click", deleteFeatItem);
document.getElementById("feat-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("feat-dialog-box").contains(e.target)) cancelFeatDialog();
});
document.getElementById("feat-dialog").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !_linkDialogOpen) cancelFeatDialog();
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) closeFeatDialog();
});

// Note dialog: Done button, backdrop click, and keyboard shortcuts.
document.getElementById("note-dialog-done-btn").addEventListener("click", closeNoteDialog);
document.getElementById("note-dialog-delete-btn").addEventListener("click", deleteNoteItem);
document.getElementById("note-dialog").addEventListener("click", (e) => {
  if (!document.getElementById("note-dialog-box").contains(e.target)) cancelNoteDialog();
});
document.getElementById("note-dialog").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !_linkDialogOpen) cancelNoteDialog();
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) closeNoteDialog();
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
document.getElementById("feat-dialog-hint").textContent = `${_modKey}+↵ to save · Esc to cancel`;
document.getElementById("note-dialog-hint").textContent = `${_modKey}+↵ to save · Esc to cancel`;
document.getElementById("level-log-dialog-hint").textContent = `${_modKey}+↵ to save · Esc to cancel`;
document.getElementById("gear-dialog-hint").textContent = `${_modKey}+↵ to save · Esc to cancel`;

["gear-dialog-description", "gear-dialog-weight"].forEach(id => {
  document.getElementById(id).addEventListener("focus", () => {
    document.getElementById("gear-dialog-field-type").textContent = fieldTypeLabel(document.getElementById(id));
  });
});

load();
