/**
 * Unit tests for static/logic.js using the Node.js built-in test runner.
 * Run with: node --test tests/unit/test_logic.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logicPath = join(__dirname, "../../static/logic.js");

const {
  escHtml,
  stripFormulaComments,
  parseFormulaRefs,
  validateFormula,
  DependencyGraph,
  renderFormula,
  renderInline,
  renderFormatted,
  render2Col,
  reorderItem,
} = await import(logicPath);

// ── escHtml ───────────────────────────────────────────────────────────────

test("escHtml escapes angle brackets", () => {
  assert.equal(escHtml("<b>hi</b>"), "&lt;b&gt;hi&lt;/b&gt;");
});

test("escHtml escapes ampersand", () => {
  assert.equal(escHtml("a & b"), "a &amp; b");
});

test("escHtml escapes double quote", () => {
  assert.equal(escHtml('"hello"'), "&quot;hello&quot;");
});

// ── stripFormulaComments ──────────────────────────────────────────────────

test("stripFormulaComments removes braced comments", () => {
  assert.equal(stripFormulaComments("10 {base} + 5"), "10  + 5");
});

test("stripFormulaComments leaves plain text untouched", () => {
  assert.equal(stripFormulaComments("42"), "42");
});

// ── parseFormulaRefs ──────────────────────────────────────────────────────

test("parseFormulaRefs returns empty array for plain formula", () => {
  assert.deepEqual(parseFormulaRefs("10 + 20"), []);
});

test("parseFormulaRefs extracts single ref", () => {
  assert.deepEqual(parseFormulaRefs("$bio.level * 100"), [
    { section: "bio", field: "level" },
  ]);
});

test("parseFormulaRefs extracts multiple refs", () => {
  const refs = parseFormulaRefs("$bio.level + $money.gp");
  assert.deepEqual(refs, [
    { section: "bio", field: "level" },
    { section: "money", field: "gp" },
  ]);
});

test("parseFormulaRefs does not match uppercase or numbers in names", () => {
  assert.deepEqual(parseFormulaRefs("$Bio.level"), []);
});

// ── renderFormula ─────────────────────────────────────────────────────────

test("renderFormula evaluates plain arithmetic", () => {
  assert.equal(renderFormula("2 + 3 * 4"), "14");
});

test("renderFormula returns empty string for empty input", () => {
  assert.equal(renderFormula(""), "");
  assert.equal(renderFormula("   "), "");
});

test("renderFormula strips comments before evaluating", () => {
  assert.equal(renderFormula("10 {base} + 5"), "15");
});

test("renderFormula returns escaped raw text on invalid syntax", () => {
  assert.equal(renderFormula("abc"), "abc");
});

test("renderFormula resolves field reference from fieldValues", () => {
  assert.equal(renderFormula("$bio.level * 1000", { "bio.level": "7" }), "7000");
});

test("renderFormula treats missing reference as 0", () => {
  assert.equal(renderFormula("$bio.level + 5", {}), "5");
});

test("renderFormula treats non-numeric reference as 0", () => {
  assert.equal(renderFormula("$bio.class + 10", { "bio.class": "Fighter" }), "10");
});

test("renderFormula handles decimal result correctly", () => {
  assert.equal(renderFormula("7 / 2"), "3.5");
});

test("renderFormula returns integer string for whole-number result", () => {
  assert.equal(renderFormula("6 / 2"), "3");
});

test("renderFormula with multiple references", () => {
  const values = { "money.pp": "2", "money.gp": "10" };
  assert.equal(renderFormula("$money.pp * 10 + $money.gp", values), "30");
});

// ── validateFormula ───────────────────────────────────────────────────────

// Only formula fields — mirrors _formulaNodeIds in app.js.
const KNOWN = new Set([
  "bio.level", "bio.experience", "money.gp", "money.ep", "money.pp",
]);

test("validateFormula returns null for empty string", () => {
  assert.equal(validateFormula("", KNOWN), null);
});

test("validateFormula returns null for plain valid formula", () => {
  assert.equal(validateFormula("1 + 2 * 3", KNOWN), null);
});

test("validateFormula returns null for valid ref", () => {
  assert.equal(validateFormula("$bio.level * 100", KNOWN), null);
});

test("validateFormula returns error for bad syntax", () => {
  assert.notEqual(validateFormula("abc !!", KNOWN), null);
});

test("validateFormula returns error for unknown ref", () => {
  const err = validateFormula("$bio.nonexistent + 1", KNOWN);
  assert.ok(err?.includes("nonexistent"), `Expected ref name in error, got: ${err}`);
});

test("validateFormula returns error for non-formula field reference", () => {
  const err = validateFormula("$bio.race + 1", KNOWN);
  assert.ok(err !== null, "Expected error for non-formula field reference");
  assert.ok(err?.includes("bio.race"), `Expected field name in error, got: ${err}`);
});

test("validateFormula returns error for self-reference", () => {
  const graph = new DependencyGraph();
  const err = validateFormula("$money.gp + 1", KNOWN, "money.gp", graph);
  assert.ok(err !== null, "Expected cycle error for self-ref");
});

test("validateFormula detects direct cycle", () => {
  const graph = new DependencyGraph();
  graph.addEdge("money.ep", "money.gp"); // ep depends on gp
  // Now try to make gp depend on ep — cycle
  const err = validateFormula("$money.ep + 1", KNOWN, "money.gp", graph);
  assert.ok(err !== null, "Expected cycle error");
  assert.ok(err?.toLowerCase().includes("cycle"), `Expected 'cycle' in error: ${err}`);
});

test("validateFormula allows non-cycle cross-reference", () => {
  const graph = new DependencyGraph();
  // gp depends on pp (already in graph)
  graph.addEdge("money.gp", "money.pp");
  // ep wants to depend on pp too — no cycle
  const err = validateFormula("$money.pp + 5", KNOWN, "money.ep", graph);
  assert.equal(err, null);
});

// ── DependencyGraph ───────────────────────────────────────────────────────

test("DependencyGraph: pathExists returns false for unconnected nodes", () => {
  const g = new DependencyGraph();
  assert.equal(g.pathExists("a", "b"), false);
});

test("DependencyGraph: addEdge creates direct path", () => {
  const g = new DependencyGraph();
  g.addEdge("a", "b");
  assert.equal(g.pathExists("a", "b"), true);
  assert.equal(g.pathExists("b", "a"), false);
});

test("DependencyGraph: pathExists finds indirect path", () => {
  const g = new DependencyGraph();
  g.addEdge("a", "b");
  g.addEdge("b", "c");
  assert.equal(g.pathExists("a", "c"), true);
  assert.equal(g.pathExists("c", "a"), false);
});

test("DependencyGraph: clearDependencies removes outgoing edges", () => {
  const g = new DependencyGraph();
  g.addEdge("a", "b");
  g.addEdge("a", "c");
  g.clearDependencies("a");
  assert.equal(g.pathExists("a", "b"), false);
  assert.equal(g.pathExists("a", "c"), false);
});

test("DependencyGraph: clearDependencies updates dependedOnBy", () => {
  const g = new DependencyGraph();
  g.addEdge("a", "b");
  g.clearDependencies("a");
  // b should no longer list a as a dependent
  assert.equal(g.dependedOnBy.get("b")?.has("a"), false);
});

test("DependencyGraph: topoSort returns single node", () => {
  const g = new DependencyGraph();
  const order = g.topoSort(new Set(["a"]));
  assert.deepEqual(order, ["a"]);
});

test("DependencyGraph: topoSort orders dependencies before dependents", () => {
  const g = new DependencyGraph();
  g.addEdge("a", "b"); // a depends on b, so b must come first
  g.addEdge("b", "c"); // b depends on c
  const order = g.topoSort(new Set(["a", "b", "c"]));
  assert.equal(order.indexOf("c") < order.indexOf("b"), true);
  assert.equal(order.indexOf("b") < order.indexOf("a"), true);
});

test("DependencyGraph: topoSort handles disconnected nodes", () => {
  const g = new DependencyGraph();
  g.addEdge("a", "b");
  const order = g.topoSort(new Set(["a", "b", "c"]));
  assert.equal(order.length, 3);
  assert.equal(order.indexOf("b") < order.indexOf("a"), true);
});

// ── renderFormatted ───────────────────────────────────────────────────────

test("renderFormatted renders bold markup", () => {
  assert.ok(renderFormatted("**hello**").includes("<strong>hello</strong>"));
});

test("renderFormatted renders bullet list", () => {
  const html = renderFormatted("* item one\n* item two");
  assert.ok(html.includes("<ul>") && html.includes("<li>item one</li>"));
});

test("renderFormatted renders ordered list", () => {
  const html = renderFormatted("1) first\n2) second");
  assert.ok(html.includes("<ol>") && html.includes("<li>first</li>"));
});

// ── reorderItem ───────────────────────────────────────────────────────────

test("reorderItem moves item up", () => {
  assert.deepEqual(reorderItem([0, 1, 2, 3], 3, 1, true), [0, 3, 1, 2]);
});

test("reorderItem moves item down", () => {
  assert.deepEqual(reorderItem([0, 1, 2, 3], 0, 2, false), [1, 2, 0, 3]);
});

test("reorderItem returns same array for same index", () => {
  assert.deepEqual(reorderItem([0, 1, 2], 1, 1, true), [0, 1, 2]);
});
