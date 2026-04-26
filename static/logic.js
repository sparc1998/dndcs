// Pure rendering and data-manipulation utilities, exported as an ES module.
// No DOM access — safe to import in Node.js for unit tests.

// Escapes <, >, &, and " so raw user text can be safely injected as innerHTML.
export function escHtml(s) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

// Strips {comment} blocks from a formula string before evaluation.
export function stripFormulaComments(raw) {
  return raw.replace(/\{[^}]*\}/g, "");
}

// Parses $section.field references from a formula string.
// Returns an array of { section, field } objects.
export function parseFormulaRefs(raw) {
  const refs = [];
  const re = /\$([a-z_]+)\.([a-z_]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    refs.push({ section: m[1], field: m[2] });
  }
  return refs;
}

// Validates a formula string. Returns null if valid, or an error message string.
// formulaNodeIds: Set<string> of valid formula-field reference targets ("section.field").
//   Only formula fields may be referenced; plain text fields are not valid targets.
// formulaNodeId: optional node ID being validated (for cycle detection).
// graph: optional DependencyGraph instance (for cycle detection).
export function validateFormula(raw, formulaNodeIds, formulaNodeId = null, graph = null) {
  if (!raw.trim()) return null;

  const refs = parseFormulaRefs(raw);
  const stripped = stripFormulaComments(raw)
    .replace(/\$[a-z_]+\.[a-z_]+/g, "1")
    .trim();

  if (stripped) {
    if (!/^[\d\s+\-*/().]+$/.test(stripped)) {
      return "Invalid formula syntax.";
    }
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function("return (" + stripped + ")")();
      if (typeof result !== "number" || !isFinite(result)) {
        return "Formula evaluates to a non-numeric or infinite value.";
      }
    } catch {
      return "Invalid formula syntax.";
    }
  }

  for (const { section, field } of refs) {
    const id = `${section}.${field}`;
    if (!formulaNodeIds.has(id)) {
      return `Only formula fields can be referenced: $${section}.${field}`;
    }
  }

  if (graph && formulaNodeId) {
    for (const { section, field } of refs) {
      const depId = `${section}.${field}`;
      if (depId === formulaNodeId) {
        return `A formula cannot reference itself ($${section}.${field}).`;
      }
      if (graph.pathExists(depId, formulaNodeId)) {
        return `Dependency cycle: $${section}.${field} already (directly or indirectly) depends on ${formulaNodeId}.`;
      }
    }
  }

  return null;
}

// Dependency graph for formula fields.
// Edge u -> v means: u depends on v (u's formula references v's computed value).
export class DependencyGraph {
  constructor() {
    this.dependsOn = new Map();    // nodeId -> Set<nodeId>
    this.dependedOnBy = new Map(); // nodeId -> Set<nodeId>
  }

  _ensure(n) {
    if (!this.dependsOn.has(n)) this.dependsOn.set(n, new Set());
    if (!this.dependedOnBy.has(n)) this.dependedOnBy.set(n, new Set());
  }

  // Returns true if target is reachable from start by following dependsOn edges.
  pathExists(start, target) {
    const visited = new Set();
    const stack = [start];
    while (stack.length) {
      const curr = stack.pop();
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const n of (this.dependsOn.get(curr) ?? [])) {
        if (n === target) return true;
        stack.push(n);
      }
    }
    return false;
  }

  // Remove all outgoing edges from u.
  clearDependencies(u) {
    for (const v of (this.dependsOn.get(u) ?? [])) {
      this.dependedOnBy.get(v)?.delete(u);
    }
    this.dependsOn.set(u, new Set());
    this._ensure(u);
  }

  // Add edge u -> v. Caller must have already validated no cycle.
  addEdge(u, v) {
    this._ensure(u);
    this._ensure(v);
    this.dependsOn.get(u).add(v);
    this.dependedOnBy.get(v).add(u);
  }

  // Topological sort of the given node set (dependencies before dependents).
  topoSort(nodeSet) {
    const indeg = new Map();
    for (const n of nodeSet) {
      let cnt = 0;
      for (const dep of (this.dependsOn.get(n) ?? [])) {
        if (nodeSet.has(dep)) cnt++;
      }
      indeg.set(n, cnt);
    }
    const queue = [...nodeSet].filter(n => indeg.get(n) === 0);
    const order = [];
    while (queue.length) {
      const curr = queue.shift();
      order.push(curr);
      for (const dep of (this.dependedOnBy.get(curr) ?? [])) {
        if (nodeSet.has(dep)) {
          const c = indeg.get(dep) - 1;
          indeg.set(dep, c);
          if (c === 0) queue.push(dep);
        }
      }
    }
    return order;
  }
}

// Evaluates a numeric formula (supports + - * / and parentheses).
// fieldValues: optional { "section.field": string } map for resolving $section.field refs.
// Returns the numeric result as a string, or the raw escaped text on error.
export function renderFormula(raw, fieldValues = {}) {
  let expr = stripFormulaComments(raw);
  expr = expr.replace(/\$([a-z_]+)\.([a-z_]+)/g, (_, section, field) => {
    const val = fieldValues[`${section}.${field}`];
    if (val === undefined || val === "") return "0";
    const n = parseFloat(val);
    return isNaN(n) ? "0" : String(n);
  }).trim();
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
export function renderInline(raw) {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|_([^_]+)_/g;
  let result = "";
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    result += escHtml(raw.slice(last, m.index));
    if (m[1] !== undefined) {
      result += `<a href="${escHtml(m[2])}" target="_blank" rel="noopener noreferrer">${renderInline(m[1])}</a>`;
    } else if (m[3] !== undefined) {
      result += `<strong>${renderInline(m[3])}</strong>`;
    } else {
      result += `<em>${renderInline(m[4])}</em>`;
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
export function renderFormatted(raw) {
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

const _isSeparator = line => /^-{3,}\s*$/.test(line);

// Splits raw text into two columns at the "---"-or-more line closest to the
// character midpoint. All separator lines are stripped from both halves.
// Falls back to a single column if no separator is present.
export function render2Col(raw) {
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

// Moves the item at fromIdx to a new position relative to targetIdx.
// isAbove=true inserts before targetIdx; false inserts after.
// Returns a new array; does not mutate the input.
export function reorderItem(arr, fromIdx, targetIdx, isAbove) {
  if (fromIdx === targetIdx) return [...arr];
  const result = [...arr];
  const [moved] = result.splice(fromIdx, 1);
  const insertAt = isAbove
    ? (fromIdx < targetIdx ? targetIdx - 1 : targetIdx)
    : (fromIdx < targetIdx ? targetIdx : targetIdx + 1);
  result.splice(insertAt, 0, moved);
  return result;
}
