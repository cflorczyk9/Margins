import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATES,
  TEMPLATE_ORDER,
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  listTemplates
} from "../src/core/templates.js";

test("TEMPLATE_ORDER and TEMPLATES stay in sync", () => {
  assert.deepEqual(
    TEMPLATE_ORDER.slice().sort(),
    Object.keys(TEMPLATES).sort(),
    "TEMPLATE_ORDER must list every template id exactly once"
  );
});

test("DEFAULT_TEMPLATE_ID is a real template", () => {
  assert.ok(TEMPLATES[DEFAULT_TEMPLATE_ID], "default template must exist");
});

test("every template declares the required shape", () => {
  for (const id of TEMPLATE_ORDER) {
    const template = TEMPLATES[id];
    assert.equal(template.id, id, `${id} id field matches key`);
    assert.equal(typeof template.label, "string", `${id} has a label`);
    assert.equal(typeof template.description, "string", `${id} has a description`);
    assert.ok(Array.isArray(template.folders), `${id} folders is an array`);
    assert.equal(typeof template.seedFiles, "object", `${id} seedFiles is an object`);

    for (const folder of template.folders) {
      assert.match(folder, /^wiki\//, `${id} extra folder ${folder} lives under wiki/`);
    }

    for (const [path, body] of Object.entries(template.seedFiles)) {
      assert.equal(typeof path, "string", `${id} seed path is string`);
      assert.equal(typeof body, "string", `${id} seed body is string`);
      assert.ok(body.length > 0, `${id} seed body for ${path} is non-empty`);
    }
  }
});

test("getTemplate returns the requested template", () => {
  assert.equal(getTemplate("student").id, "student");
});

test("getTemplate falls back to the default for unknown ids", () => {
  assert.equal(getTemplate("nope").id, DEFAULT_TEMPLATE_ID);
});

test("listTemplates returns templates in TEMPLATE_ORDER", () => {
  const ids = listTemplates().map((t) => t.id);
  assert.deepEqual(ids, TEMPLATE_ORDER);
});
