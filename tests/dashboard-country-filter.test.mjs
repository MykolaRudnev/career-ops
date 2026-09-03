import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inferJobCountries } from "../server/jobCountry.mjs";

test("infers countries from explicit country names and common cities", () => {
  assert.deepEqual(inferJobCountries("Remote, Poland"), ["Poland"]);
  assert.deepEqual(inferJobCountries("Berlin, Remote"), ["Germany"]);
  assert.deepEqual(inferJobCountries("Amsterdam"), ["Netherlands"]);
  assert.deepEqual(inferJobCountries("Łódź"), ["Poland"]);
});

test("keeps multi-country remote eligibility filterable", () => {
  assert.deepEqual(inferJobCountries("Remote, Canada; Remote, United States"), ["United States", "Canada"]);
});

test("classifies worldwide, Europe, and missing locations without guessing", () => {
  assert.deepEqual(inferJobCountries("Remote worldwide"), ["Worldwide"]);
  assert.deepEqual(inferJobCountries("EMEA Remote"), ["Europe / EMEA"]);
  assert.deepEqual(inferJobCountries(""), ["Unknown"]);
});

test("dashboard scan counters preserve a legitimate zero", () => {
  const source = fs.readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /totalAdded \?\? 0/);
  assert.doesNotMatch(source, /totalAdded \|\| 638/);
});
