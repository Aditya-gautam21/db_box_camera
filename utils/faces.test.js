import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFaces, parseFaceFilename } from "./faces.js";

test("parses name and start, end is snap + 5 minutes", () => {
  const face = parseFaceFilename("ashu-2026-08-21_16-35-09.jpg");
  assert.equal(face.name, "ashu");
  assert.equal(face.start, "2026-08-21T16:35:09Z");
  assert.equal(face.end, "2026-08-21T16:40:09Z");
});

test("parses duplicate stamp with extra snap id", () => {
  const face = parseFaceFilename("Stranger-2026-08-21_16-34-55-12471.jpg");
  assert.equal(face.name, "Stranger");
  assert.equal(face.start, "2026-08-21T16:34:55Z");
  assert.equal(face.end, "2026-08-21T16:39:55Z");
});

test("rolls over midnight when adding 5 minutes", () => {
  const face = parseFaceFilename("unknown-2026-08-21_23-58-00.jpg");
  assert.equal(face.start, "2026-08-21T23:58:00Z");
  assert.equal(face.end, "2026-08-22T00:03:00Z");
});

test("legacy uuid filenames have no playable time", () => {
  const face = parseFaceFilename("ashu-1RQAAKwEOQ8ECAEA.jpg");
  assert.equal(face.name, "ashu-1RQAAKwEOQ8ECAEA");
  assert.equal(face.start, null);
  assert.equal(face.end, null);
});

test("lists snapshots newest-first with encoded image urls", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faces-"));
  fs.writeFileSync(path.join(dir, "ashu-2026-08-21_16-35-09.jpg"), "");
  fs.writeFileSync(path.join(dir, "ashu-+old.jpg"), "");
  fs.writeFileSync(path.join(dir, "skip.txt"), "");
  const faces = listFaces(dir);
  assert.equal(faces.length, 2);
  assert.equal(faces[0].filename, "ashu-2026-08-21_16-35-09.jpg");
  assert.equal(faces[0].start, "2026-08-21T16:35:09Z");
  assert.equal(faces[0].end, "2026-08-21T16:40:09Z");
  assert.equal(faces[0].url, "/face-data/ashu-2026-08-21_16-35-09.jpg");
  assert.equal(faces[1].start, null);
  assert.equal(faces[1].url, "/face-data/ashu-%2Bold.jpg");
  fs.rmSync(dir, { recursive: true });
});
