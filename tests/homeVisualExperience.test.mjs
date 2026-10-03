import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const setup = read("components/SessionSetup.tsx");
const styles = read("app/globals.css");
const layout = read("app/layout.tsx");
const illumination = read("components/ui/CursorIllumination.tsx");
const appRoutes = [
  "app/page.tsx",
  "app/session/[sessionId]/page.tsx",
  "app/researcher/page.tsx",
  "app/researcher/records/page.tsx",
  "app/researcher/setup/page.tsx",
  "app/researcher/session/[sessionId]/page.tsx",
];

test("minimal homepage preserves participant setup and protected researcher entry", () => {
  assert.match(setup, /CREATIVE DESIGN STUDY/);
  assert.match(setup, /Elsewhere/);
  assert.match(setup, /Participant session/);
  assert.match(setup, /Anonymous Participant ID/);
  assert.match(setup, /Start session/);
  assert.match(setup, /Researcher records/);
  assert.match(setup, /onOpenResearcherRecords/);
  assert.match(setup, /Minimum recommended width: 1024px/);
  assert.match(setup, /disabled=\{creating\}/);
  assert.match(setup, /Assigned automatically/);
  assert.doesNotMatch(setup, /Condition A|Condition B/);
});

test("rejected homepage artwork and artwork interactions are absent", () => {
  assert.doesNotMatch(setup, /ArtistMachine|ArtistHistory|TraceCursor|<img|<svg/);
  assert.equal(existsSync(new URL("../components/home/ArtistMachineIllustration.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/home/ArtistMachineTableau.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/home/ArtistHistoryCollage.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/home/TraceCursor.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/artwork/homepage", import.meta.url)), false);
  assert.equal(existsSync(new URL("../research-materials/Homepage_Artwork_Sources.md", import.meta.url)), false);
  assert.doesNotMatch(styles, /artistMachine|artistTableau|artistHistoryCollage|collagePortrait|collageScreen|traceCursor|parallax/i);
});

test("application uses the restrained dark clinical token system", () => {
  const tokens = {
    "--bg-0": "#0a0d12",
    "--bg-1": "#0c1016",
    "--bg-2": "#131922",
    "--bg-3": "#1b2230",
    "--text-primary": "#f6f7f8",
    "--text-secondary": "#a7adb5",
    "--accent-forest": "#afc9e8",
    "--success": "#91b7a4",
    "--warning": "#c0a578",
    "--danger": "#c78282",
  };
  for (const [token, value] of Object.entries(tokens)) {
    assert.match(styles, new RegExp(`${token}: ${value}`));
  }
  assert.match(styles, /\.homeMinimal/);
  assert.match(styles, /Dark clinical instrument visual system/);
  assert.match(styles, /Premium depth refinement/);
  assert.match(styles, /backdrop-filter: blur\(30px\) saturate\(128%\)/);
  assert.match(styles, /@keyframes instrumentEnter/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("cursor illumination is passive, frame-scheduled, and globally mounted", () => {
  assert.match(layout, /<CursorIllumination \/>/);
  assert.match(illumination, /requestAnimationFrame/);
  assert.match(illumination, /pointer: fine/);
  assert.match(illumination, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(illumination, /setState|useState/);
  assert.match(styles, /\.cursorIllumination/);
  assert.match(styles, /pointer-events: none/);
});

test("the visual refinement introduces no new public application route", () => {
  assert.equal(appRoutes.length, 6);
  assert.doesNotMatch(setup, /href=.*participant|router\.push\(.+participant/);
});
