import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBoardCompletion, getBoardProgress, getBoardReadiness, isValidHex, updateBoardField } from "../services/boardUtils.ts";

const root = new URL("../", import.meta.url);
const boardSource = readFileSync(new URL("components/WorkingBoard.tsx", root), "utf8");

const baseBoard = () => ({
  concept: "word ".repeat(30).trim(), keywords: ["one", "two", "three", "four", "five", "six"],
  personalityTraits: ["Calm", "Clear", "Warm", "Human"], audienceDescription: "Audience", audienceCoreNeed: "Need", audienceEmotionalResponse: "Response",
  primaryColour: "", secondaryColour1: "", secondaryColour2: "", accentColour: "", paletteRationale: "",
  primaryTypeStyle: "", secondaryTypeStyle: "", typographyMood: [], typographyRationale: "",
  selectedLogoImageId: "IMG01", logoDirectionNote: "A retained symbol direction",
  selectedVisualImageIds: ["IMG01"], visualReferenceNotes: { IMG01: "A retained visual direction" },
  toneTraits: [], sampleLine: "", visualDos: [], visualDonts: [], rationale: "x".repeat(150),
  confirmedSections: ["concept", "keywords", "personality", "audience", "logo", "visuals", "rationale"],
});

test("valid manual Primary HEX updates authoritative board state and removes its empty condition", () => {
  const updated = updateBoardField(baseBoard(), "primaryColour", "#FAF1EA");
  assert.equal(updated.primaryColour, "#FAF1EA");
  assert.equal(isValidHex(updated.primaryColour), true);
});

test("rapid palette updates derive from the latest authoritative board and retain Primary", () => {
  let board = baseBoard();
  board = updateBoardField(board, "primaryColour", "#FAF1EA");
  board = updateBoardField(board, "secondaryColour1", "#78828A");
  board = updateBoardField(board, "secondaryColour2", "#A39A8F");
  board = updateBoardField(board, "accentColour", "#784C43");
  assert.deepEqual(
    [board.primaryColour, board.secondaryColour1, board.secondaryColour2, board.accentColour],
    ["#FAF1EA", "#78828A", "#A39A8F", "#784C43"],
  );
  assert.equal(getBoardReadiness(board).palette, true);
});

test("invalid Primary HEX remains invalid and cannot complete the palette", () => {
  const board = { ...baseBoard(), primaryColour: "#FAF1E", secondaryColour1: "#78828A", secondaryColour2: "#A39A8F", accentColour: "#784C43" };
  assert.equal(isValidHex(board.primaryColour), false);
  assert.equal(getBoardReadiness(board).palette, false);
});

test("palette rationale remains optional and four valid colours can take required progress from 7/8 to 8/8", () => {
  const ready = { ...baseBoard(), primaryColour: "#FAF1EA", secondaryColour1: "#78828A", secondaryColour2: "#A39A8F", accentColour: "#784C43" };
  assert.equal(ready.paletteRationale, "");
  assert.equal(getBoardReadiness(ready).palette, true);
  assert.equal(getBoardProgress(ready).requiredComplete, 7);
  const confirmed = updateBoardField(ready, "confirmedSections", [...ready.confirmedSections, "palette"]);
  assert.equal(getBoardCompletion(confirmed).palette, true);
  assert.equal(getBoardProgress(confirmed).requiredComplete, 8);
});

test("Primary survives autosave serialization, refresh hydration, and recovery cloning", () => {
  const board = updateBoardField(baseBoard(), "primaryColour", "#FAF1EA");
  const autosaved = JSON.stringify({ board });
  const hydrated = JSON.parse(autosaved).board;
  const recovered = structuredClone(hydrated);
  assert.equal(hydrated.primaryColour, "#FAF1EA");
  assert.equal(recovered.primaryColour, "#FAF1EA");
  assert.equal(isValidHex(recovered.primaryColour), true);
});

test("manual text and native colour picker share the same authoritative update path", () => {
  assert.match(boardSource, /const boardRef = useRef\(board\)/);
  assert.match(boardSource, /useEffect\(\(\) => \{ boardRef\.current = board; \}, \[board\]\)/);
  assert.match(boardSource, /const next = updateBoardField\(boardRef\.current, key, value\)/);
  assert.match(boardSource, /type="color"[\s\S]*?onChange=\{\(e\) => update\(key, e\.target\.value\.toUpperCase\(\)\)\}/);
  assert.match(boardSource, /id=\{`hex-\$\{key\}`\}[\s\S]*?onChange=\{\(e\) => update\(key, e\.target\.value\.toUpperCase\(\)\)\}/);
});

test("secondary and accent colour validation remains unchanged", () => {
  for (const key of ["secondaryColour1", "secondaryColour2", "accentColour"]) {
    const board = updateBoardField(baseBoard(), key, "#123ABC");
    assert.equal(board[key], "#123ABC");
    assert.equal(isValidHex(board[key]), true);
  }
});
