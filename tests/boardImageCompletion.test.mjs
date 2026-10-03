import test from "node:test";
import assert from "node:assert/strict";
import { getBoardCompletion, getBoardReadiness, MIN_FINAL_RATIONALE_CHARACTERS, reconcileImageSectionConfirmations } from "../services/boardUtils.ts";

const baseBoard = () => ({
  concept: "", keywords: [], personalityTraits: [], audienceDescription: "", audienceCoreNeed: "", audienceEmotionalResponse: "",
  primaryColour: "", secondaryColour1: "", secondaryColour2: "", accentColour: "", paletteRationale: "",
  primaryTypeStyle: "", secondaryTypeStyle: "", typographyMood: [], typographyRationale: "",
  selectedLogoImageId: undefined, logoDirectionNote: "", selectedVisualImageIds: [], visualReferenceNotes: {},
  toneTraits: [], sampleLine: "", visualDos: [], visualDonts: [], rationale: "", confirmedSections: [],
});

test("Case A: an image with an empty note is not ready", () => {
  const board = { ...baseBoard(), selectedLogoImageId: "IMG01" };
  assert.equal(getBoardReadiness(board).logo, false);
});

test("Case B: a valid-length note without an image is not ready", () => {
  const board = { ...baseBoard(), logoDirectionNote: "abcdefghijklmno" };
  assert.equal(getBoardReadiness(board).logo, false);
});

test("Case C: fewer than 15 non-whitespace characters is not ready", () => {
  const board = { ...baseBoard(), selectedLogoImageId: "IMG01", logoDirectionNote: "abcdef ghijklmn" };
  assert.equal(getBoardReadiness(board).logo, false);
});

test("Case D and E: valid image plus note can be explicitly completed", () => {
  const ready = { ...baseBoard(), selectedLogoImageId: "IMG01", logoDirectionNote: "abcdefghijklmno" };
  assert.equal(getBoardReadiness(ready).logo, true);
  const confirmed = { ...ready, confirmedSections: ["logo"] };
  assert.equal(getBoardCompletion(confirmed).logo, true);
});

test("Case F: removing the selected image automatically removes completion", () => {
  const completed = { ...baseBoard(), selectedLogoImageId: "IMG01", logoDirectionNote: "abcdefghijklmno", confirmedSections: ["logo"] };
  const reconciled = reconcileImageSectionConfirmations({ ...completed, selectedLogoImageId: undefined });
  assert.equal(reconciled.confirmedSections.includes("logo"), false);
  assert.equal(getBoardCompletion(reconciled).logo, false);
  assert.equal(reconciled.logoDirectionNote, completed.logoDirectionNote);
});

test("Case G: shortening the note automatically removes completion", () => {
  const completed = { ...baseBoard(), selectedLogoImageId: "IMG01", logoDirectionNote: "abcdefghijklmno", confirmedSections: ["logo"] };
  const reconciled = reconcileImageSectionConfirmations({ ...completed, logoDirectionNote: "too short" });
  assert.equal(reconciled.confirmedSections.includes("logo"), false);
  assert.equal(reconciled.selectedLogoImageId, "IMG01");
});

test("visual references independently require every selected image note", () => {
  const oneReady = { ...baseBoard(), selectedVisualImageIds: ["IMG01"], visualReferenceNotes: { IMG01: "abcdefghijklmno" } };
  assert.equal(getBoardReadiness(oneReady).visuals, true);
  const secondMissing = { ...oneReady, selectedVisualImageIds: ["IMG01", "IMG02"] };
  assert.equal(getBoardReadiness(secondMissing).visuals, false);
  const bothReady = { ...secondMissing, visualReferenceNotes: { IMG01: "abcdefghijklmno", IMG02: "secondvisualnote" } };
  assert.equal(getBoardReadiness(bothReady).visuals, true);
});

test("Cases H and I: valid completion survives serialization and review calculation", () => {
  const completed = {
    ...baseBoard(),
    selectedLogoImageId: "IMG01",
    logoDirectionNote: "abcdefghijklmno",
    selectedVisualImageIds: ["IMG01"],
    visualReferenceNotes: { IMG01: "visualdirection" },
    confirmedSections: ["logo", "visuals"],
  };
  const restored = JSON.parse(JSON.stringify(completed));
  const completion = getBoardCompletion(restored);
  assert.equal(completion.logo, true);
  assert.equal(completion.visuals, true);
});

test("final rationale requires at least 150 non-whitespace characters", () => {
  assert.equal(MIN_FINAL_RATIONALE_CHARACTERS, 150);
  assert.equal(getBoardReadiness({ ...baseBoard(), rationale: "x".repeat(149) }).rationale, false);
  assert.equal(getBoardReadiness({ ...baseBoard(), rationale: "x".repeat(150) }).rationale, true);
  assert.equal(getBoardReadiness({ ...baseBoard(), rationale: `${"word ".repeat(81)}${"x".repeat(150)}` }).rationale, false);
});
