// @vitest-environment jsdom
import { getParticipantNames, getSpeakingNames } from "../src/content/meetSelectors";

function load(html: string): Document {
  const doc = document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = html;
  return doc;
}
import fixture from "./fixtures/meet-speaking.html?raw";

test("fixture: only Reza is speaking", () => {
  expect(getSpeakingNames(load(fixture))).toEqual(new Set(["Reza"]));
});

test("fixture: participants are trimmed, deduplicated, ordered, non-empty", () => {
  expect(getParticipantNames(load(fixture))).toEqual(["Reza", "Sara"]);
});

test("empty document returns empty values without throwing", () => {
  const doc = load("");
  expect(getSpeakingNames(doc)).toEqual(new Set());
  expect(getParticipantNames(doc)).toEqual([]);
});

test("selector exceptions yield empty results", () => {
  const bad = { querySelectorAll: () => { throw new Error("boom"); } } as unknown as Document;
  expect(getSpeakingNames(bad)).toEqual(new Set());
  expect(getParticipantNames(bad)).toEqual([]);
});

test("speaking via indicator class strategy and tile attribute strategy", () => {
  const doc = load(`
    <div data-requested-participant-id="a"><span data-self-name="Ali"></span><div class="gjg47c"></div></div>
    <div data-participant-id="b" data-is-speaking="true"><span data-self-name="Bita"></span></div>
    <div data-participant-id="c"><span data-self-name="Cyrus"></span><div class="gjg47c-not"></div></div>`);
  expect(getSpeakingNames(doc)).toEqual(new Set(["Ali", "Bita"]));
});

test("icon glyph text is never a name (live Meet 2026-11-06: visual_effects / keep_off)", () => {
  const doc = load(`
    <div data-participant-id="a" data-is-speaking="true">
      <i class="google-material-icons notranslate" aria-hidden="true">visual_effects</i>
      <span class="google-symbols notranslate">keep_off</span>
      <div class="zWGUib">Sina Haseli</div>
    </div>
    <div data-participant-id="b">
      <span class="notranslate">more_vert</span>
      <span class="notranslate">mic_off</span>
    </div>`);
  expect(getParticipantNames(doc)).toEqual(["Sina Haseli"]);
  expect(getSpeakingNames(doc)).toEqual(new Set(["Sina Haseli"]));
});

test("an icon ligature in a name attribute or plain element is rejected too", () => {
  const doc = load(`
    <div data-participant-id="a"><span data-self-name="keep_off"></span><div class="notranslate">Reza</div></div>
    <div data-participant-id="b"><div aria-hidden="true"><span class="notranslate">Ghost</span></div></div>`);
  expect(getParticipantNames(doc)).toEqual(["Reza"]);
});

test("name falls back to a name-element text; UI strings are ignored", () => {
  const doc = load(`
    <div data-participant-id="a"><div class="zWGUib">Dana</div></div>
    <div data-participant-id="b"><div class="zWGUib">You</div></div>
    <div data-participant-id="c"><div class="zWGUib">Presentation</div></div>`);
  expect(getParticipantNames(doc)).toEqual(["Dana"]);
});
