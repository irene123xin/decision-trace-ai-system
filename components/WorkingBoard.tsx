"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { boardSectionLabels, countNonWhitespaceCharacters, countWords, getBoardProgress, getBoardReadiness, isValidHex, MIN_FINAL_RATIONALE_CHARACTERS, MIN_IMAGE_DIRECTION_NOTE_CHARACTERS, requiredBoardSections, supportingBoardSections, updateBoardField } from "@/services/boardUtils";
import type { BoardInteractionEvent, BoardSectionId, DecisionAction, DecisionObject, DecisionSource, FinalDirectionBoard, GeneratedImage } from "@/types";

interface BoardEventOptions {
  action?: DecisionAction;
  source?: DecisionSource;
  relatedImageId?: string;
  eventType?: BoardInteractionEvent["eventType"];
  beforeValue?: unknown;
  afterValue?: unknown;
  createDecision?: boolean;
}

interface Props {
  board: FinalDirectionBoard;
  images: GeneratedImage[];
  onChange: (board: FinalDirectionBoard) => void;
  onEvent?: (object: DecisionObject, summary: string, options?: BoardEventOptions) => void;
  onSelectImage?: (id: string, target: "logo" | "visual") => void;
  full?: boolean;
  submitted?: boolean;
  errors?: string[];
  onSubmit?: () => void;
  initialSection?: BoardSectionId;
}

const personalityOptions = ["Calm", "Clear", "Contemporary", "Warm", "Structured", "Human", "Optimistic", "Grounded", "Expressive", "Minimal", "Experimental", "Approachable"];
const typeStyles = ["Geometric Sans", "Humanist Sans", "Grotesk Sans", "Serif", "Display", "Monospaced", "Mixed"];
const typeMoods = ["Calm", "Editorial", "Friendly", "Precise", "Contemporary", "Soft", "Structured", "Expressive"];
const toneOptions = ["Clear", "Warm", "Direct", "Reassuring", "Thoughtful", "Optimistic", "Minimal", "Conversational", "Confident", "Calm"];
const emptyColours = { primaryColour: "", secondaryColour1: "", secondaryColour2: "", accentColour: "" };
const sectionNumbers: Record<BoardSectionId, string> = { concept: "01", keywords: "02", personality: "03", audience: "04", palette: "05", logo: "06", visuals: "07", rationale: "08", typography: "09", tone: "10", principles: "11" };

const BoardSectionContext = createContext<{ expanded: BoardSectionId; open: (section: BoardSectionId) => void; readiness: Record<BoardSectionId, boolean> } | null>(null);

function fontStack(style: string) {
  if (style === "Serif") return "Georgia, 'Times New Roman', serif";
  if (style === "Monospaced") return "ui-monospace, SFMono-Regular, Menlo, monospace";
  if (style === "Display") return "Impact, Haettenschweiler, sans-serif";
  if (style === "Humanist Sans") return "Trebuchet MS, Verdana, sans-serif";
  if (style === "Grotesk Sans") return "Arial, Helvetica, sans-serif";
  return "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

function Section({ id, number: _number, board, complete, children, onConfirm, incompleteMessage }: { id: BoardSectionId; number: string; board: FinalDirectionBoard; complete: boolean; children: React.ReactNode; onConfirm?: () => void; incompleteMessage?: string }) {
  const context = useContext(BoardSectionContext);
  const confirmed = complete;
  const supporting = supportingBoardSections.includes(id);
  const expanded = context?.expanded === id;
  const ready = context?.readiness[id] ?? false;
  return (
    <section className={`canvasSection section-${id} ${complete ? "isComplete" : ""} ${expanded ? "expanded" : "collapsed"}`} id={`board-${id}`}>
      <header className="canvasSectionHeader"><button type="button" aria-expanded={expanded} aria-controls={`board-${id}-content`} onClick={() => context?.open(id)}><span>{sectionNumbers[id]}</span><h3>{boardSectionLabels[id]}</h3></button><span className={`completionMark ${complete ? "complete" : ""}`}>{complete ? "Complete" : supporting ? "Supporting" : "Still needed"}</span></header>
      {expanded && <div className="canvasSectionContent" id={`board-${id}-content`}>{children}{onConfirm && <footer className="sectionConfirm"><span>{confirmed ? "Section included in Final Review." : ready ? "This section is ready to mark complete." : incompleteMessage ?? "Complete the section before marking it complete."}</span>{confirmed ? <span className="sectionCompletedState">Completed ✓</span> : ready ? <button type="button" onClick={onConfirm}>Mark section complete</button> : null}</footer>}</div>}
    </section>
  );
}

function ChipGroup({ options, selected, limit, onToggle, label }: { options: string[]; selected: string[]; limit: number; onToggle: (value: string) => void; label: string }) {
  return <div className="chipGroup" role="group" aria-label={label}>{options.map((option) => { const active = selected.includes(option); return <button type="button" key={option} className={`choiceChip ${active ? "selected" : ""}`} aria-pressed={active} disabled={!active && selected.length >= limit} onClick={() => onToggle(option)}>{option}{active && <span aria-hidden>✓</span>}</button>; })}</div>;
}

export function WorkingBoard({ board, images, onChange, onEvent, onSelectImage, full = false, submitted = false, errors = [], onSubmit, initialSection }: Props) {
  const [customTrait, setCustomTrait] = useState("");
  const [expandedSection, setExpandedSection] = useState<BoardSectionId>(initialSection ?? "concept");
  const editStarts = useRef<Record<string, string>>({});
  const boardRef = useRef(board);
  useEffect(() => { boardRef.current = board; }, [board]);
  const progress = useMemo(() => getBoardProgress(board), [board]);
  const readiness = useMemo(() => getBoardReadiness(board), [board]);
  const completion = progress.completion;
  const update = <K extends keyof FinalDirectionBoard>(key: K, value: FinalDirectionBoard[K]) => {
    const next = updateBoardField(boardRef.current, key, value);
    boardRef.current = next;
    onChange(next);
  };
  const beginEdit = (key: string, value: string) => { editStarts.current[key] = value; };
  const finishEdit = (key: string, value: string, object: DecisionObject, label: string) => {
    const before = editStarts.current[key] ?? value;
    delete editStarts.current[key];
    if (before.trim() === value.trim()) return;
    onEvent?.(object, `${before.trim() ? "Modified" : "Added"} ${label}.`, { action: before.trim() ? "Modify" : "Human-initiated", source: "Human-initiated", eventType: "field_edit", beforeValue: before, afterValue: value, createDecision: true });
  };
  const confirm = (section: BoardSectionId) => {
    const exists = board.confirmedSections.includes(section);
    const confirmedSections = exists ? board.confirmedSections.filter((item) => item !== section) : [...board.confirmedSections, section];
    update("confirmedSections", confirmedSections);
    onEvent?.(section === "rationale" ? "Final selection" : section === "principles" ? "Visual principles" : section === "visuals" ? "Visual style" : section === "personality" ? "Brand personality" : section === "audience" ? "Audience interpretation" : section === "typography" ? "Typography" : section === "tone" ? "Tone of voice" : section === "palette" ? "Colour palette" : section === "logo" ? "Logo or symbol" : section === "keywords" ? "Keywords" : "Brand concept", `${exists ? "Removed confirmation from" : "Confirmed"} the ${boardSectionLabels[section].toLowerCase()} section.`, { action: "Human-initiated", eventType: "section_confirmation", beforeValue: exists, afterValue: !exists, createDecision: false });
  };
  const toggleLimited = (key: "personalityTraits" | "typographyMood" | "toneTraits", value: string, limit: number, object: DecisionObject) => {
    const current = board[key]; const active = current.includes(value);
    const next = active ? current.filter((item) => item !== value) : current.length < limit ? [...current, value] : current;
    if (next === current) return;
    update(key, next);
    onEvent?.(object, `${active ? "Removed" : "Selected"} “${value}” in the ${object.toLowerCase()} direction.`, { action: "Human-initiated", source: "Human-initiated", eventType: active ? "removal" : "selection", beforeValue: current, afterValue: next, createDecision: true });
  };
  const keywordUpdate = (index: number, value: string) => { const next = [...board.keywords]; next[index] = value; update("keywords", next); };
  const moveKeyword = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= board.keywords.length) return; const before = [...board.keywords]; const next = [...board.keywords]; [next[index], next[target]] = [next[target], next[index]]; update("keywords", next); onEvent?.("Keywords", "Reordered the final keyword set.", { action: "Modify", source: "Human-initiated", eventType: "replacement", beforeValue: before, afterValue: next, createDecision: true }); };
  const colourFields: { key: "primaryColour" | "secondaryColour1" | "secondaryColour2" | "accentColour"; label: string }[] = [{ key: "primaryColour", label: "Primary" }, { key: "secondaryColour1", label: "Secondary 01" }, { key: "secondaryColour2", label: "Secondary 02" }, { key: "accentColour", label: "Accent" }];
  const logoImages = images.filter((image) => image.id === board.selectedLogoImageId);
  const visualImages = images.filter((image) => board.selectedVisualImageIds.includes(image.id));
  const logoNoteCharacters = countNonWhitespaceCharacters(board.logoDirectionNote.trim());
  const validVisualNoteCount = board.selectedVisualImageIds.filter((id) => countNonWhitespaceCharacters((board.visualReferenceNotes[id] ?? "").trim()) >= MIN_IMAGE_DIRECTION_NOTE_CHARACTERS).length;
  const hasAnyVisualNote = Object.values(board.visualReferenceNotes).some((note) => countNonWhitespaceCharacters(note.trim()) > 0);
  const logoIncompleteMessage = !board.selectedLogoImageId
    ? logoNoteCharacters > 0 ? "Add at least one generated image before marking this section complete." : "Add at least one generated image to this section."
    : "Add a brief direction note before marking this section complete.";
  const visualsIncompleteMessage = board.selectedVisualImageIds.length === 0
    ? hasAnyVisualNote ? "Add at least one generated image before marking this section complete." : "Add at least one generated image to this section."
    : "Add a brief direction note before marking this section complete.";

  return (
    <section className={`boardPanel directionCanvas ${full ? "fullBoard" : ""}`}>
      <div className="boardCanvasHeader"><div><p className="eyebrow">EARLY BRAND DIRECTION BOARD</p><h2>Elsewhere direction canvas</h2><p>Add the directions you wish to develop to the Working Board.</p></div><div className="boardSaveState"><span><i /> Saved</span><strong>{progress.requiredComplete} / 8</strong><small>required · {progress.allComplete}/11 all</small></div></div>
      <nav className="boardSectionNav" aria-label="Board sections"><div><strong>Core required</strong>{requiredBoardSections.map((section, index) => <button type="button" key={section} onClick={() => setExpandedSection(section)} className={`${completion[section] ? "complete" : ""} ${expandedSection === section ? "active" : ""}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{boardSectionLabels[section]}</b><i>{completion[section] ? "Complete" : "Still needed"}</i></button>)}</div><div className="supportingNav"><strong>Supporting</strong>{supportingBoardSections.map((section, index) => <button type="button" key={section} onClick={() => setExpandedSection(section)} className={`${completion[section] ? "complete" : ""} ${expandedSection === section ? "active" : ""}`}><span>{String(index + 9).padStart(2, "0")}</span><b>{boardSectionLabels[section]}</b><i>{completion[section] ? "Complete" : "Supporting"}</i></button>)}</div></nav>
      {errors.length > 0 && <div className="validationSummary" role="status"><strong>Complete before submission</strong><p>A few parts of the direction are still needed.</p><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}

      <BoardSectionContext.Provider value={{ expanded: expandedSection, open: setExpandedSection, readiness }}><div className="canvasGrid">
        <Section id="concept" number="01" board={board} complete={completion.concept} onConfirm={() => confirm("concept")}><p className="sectionHelper">Define the core idea, value and emotional direction in one concise statement.</p><label className="editorialField"><textarea disabled={submitted} rows={5} value={board.concept} onFocus={() => beginEdit("concept", board.concept)} onChange={(e) => update("concept", e.target.value)} onBlur={() => finishEdit("concept", board.concept, "Brand concept", "the brand concept direction")} placeholder="Describe the central idea for Elsewhere…" /><span className={countWords(board.concept) > 60 ? "limitOver" : ""}>{countWords(board.concept)} / 30–60 words</span></label></Section>

        <Section id="keywords" number="02" board={board} complete={completion.keywords} onConfirm={() => confirm("keywords")}><div className="keywordEditor">{board.keywords.map((keyword, index) => <div className="keywordChipEdit" key={index}><span>{String(index + 1).padStart(2, "0")}</span><input disabled={submitted} value={keyword} aria-label={`Keyword ${index + 1}`} placeholder="Add keyword" onFocus={() => beginEdit(`keyword-${index}`, keyword)} onChange={(e) => keywordUpdate(index, e.target.value)} onBlur={() => finishEdit(`keyword-${index}`, keyword, "Keywords", `keyword ${index + 1}`)} /><div><button type="button" disabled={submitted || index === 0} onClick={() => moveKeyword(index, -1)} aria-label={`Move keyword ${index + 1} earlier`}>←</button><button type="button" disabled={submitted || index === board.keywords.length - 1} onClick={() => moveKeyword(index, 1)} aria-label={`Move keyword ${index + 1} later`}>→</button><button type="button" disabled={submitted} onClick={() => { const next = board.keywords.filter((_, itemIndex) => itemIndex !== index); update("keywords", next); onEvent?.("Keywords", `Removed the keyword “${keyword || `item ${index + 1}`}” from the final set.`, { action: "Modify", source: "Human-initiated", eventType: "removal", beforeValue: board.keywords, afterValue: next, createDecision: Boolean(keyword.trim()) }); }} aria-label={`Remove keyword ${index + 1}`}>×</button></div></div>)}</div>{board.keywords.length < 6 && <button type="button" className="addDirection" disabled={submitted} onClick={() => { update("keywords", [...board.keywords, ""]); onEvent?.("Keywords", "Added an empty keyword field.", { eventType: "field_edit", beforeValue: board.keywords.length, afterValue: board.keywords.length + 1, createDecision: false }); }}>＋ Add keyword <span>{board.keywords.length} / 6</span></button>}<p className="compactLimit">Six final keywords · drag-free arrow controls support keyboard reordering.</p></Section>

        <Section id="personality" number="03" board={board} complete={completion.personality} onConfirm={() => confirm("personality")}><div className="selectionMeta"><p>Select exactly four traits.</p><strong>{board.personalityTraits.length} / 4 selected</strong></div><ChipGroup options={[...new Set([...personalityOptions, ...board.personalityTraits.filter((trait) => !personalityOptions.includes(trait))])]} selected={board.personalityTraits} limit={4} label="Brand personality traits" onToggle={(value) => toggleLimited("personalityTraits", value, 4, "Brand personality")} /><div className="inlineAdd"><input value={customTrait} onChange={(e) => setCustomTrait(e.target.value)} placeholder="Add custom trait" maxLength={24} /><button type="button" disabled={!customTrait.trim() || board.personalityTraits.length >= 4} onClick={() => { const value = customTrait.trim(); if (!board.personalityTraits.includes(value)) { const next = [...board.personalityTraits, value]; update("personalityTraits", next); onEvent?.("Brand personality", `Introduced the custom personality trait “${value}”.`, { action: "Human-initiated", source: "Human-initiated", eventType: "selection", beforeValue: board.personalityTraits, afterValue: next, createDecision: true }); } setCustomTrait(""); }}>Add</button></div></Section>

        <Section id="audience" number="04" board={board} complete={completion.audience} onConfirm={() => confirm("audience")}><p className="sectionHelper">Interpret the fixed 20–35 audience; do not redefine it.</p><div className="audienceFields"><label>Primary audience description<textarea rows={2} value={board.audienceDescription} onFocus={() => beginEdit("audience-description", board.audienceDescription)} onChange={(e) => update("audienceDescription", e.target.value)} onBlur={() => finishEdit("audience-description", board.audienceDescription, "Audience interpretation", "the primary audience interpretation")} placeholder="How do you interpret this fragrance audience?" /><span>{countWords(board.audienceDescription)} / 20</span></label><label>Core need<input value={board.audienceCoreNeed} onFocus={() => beginEdit("audience-need", board.audienceCoreNeed)} onChange={(e) => update("audienceCoreNeed", e.target.value)} onBlur={() => finishEdit("audience-need", board.audienceCoreNeed, "Audience interpretation", "the audience core need")} placeholder="What do they need most?" /><span>{countWords(board.audienceCoreNeed)} / 15</span></label><label>Desired emotional response<input value={board.audienceEmotionalResponse} onFocus={() => beginEdit("audience-response", board.audienceEmotionalResponse)} onChange={(e) => update("audienceEmotionalResponse", e.target.value)} onBlur={() => finishEdit("audience-response", board.audienceEmotionalResponse, "Audience interpretation", "the desired audience response")} placeholder="What response should the direction invite?" /><span>{countWords(board.audienceEmotionalResponse)} / 15</span></label></div></Section>

        <Section id="palette" number="05" board={board} complete={completion.palette} onConfirm={() => confirm("palette")}><div className="paletteStudio"><div className="paletteStrip">{colourFields.map(({ key }) => <span className={isValidHex(board[key]) ? "" : "empty"} key={key} style={isValidHex(board[key]) ? { backgroundColor: board[key] } : undefined} />)}</div><div className="colourGrid">{colourFields.map(({ key, label }) => <div className={`colourControl ${isValidHex(board[key]) ? "" : "empty"}`} key={key}>{isValidHex(board[key]) ? <input className="nativeColour" type="color" value={board[key]} aria-label={`${label} colour picker`} onFocus={() => beginEdit(`colour-${key}`, board[key])} onChange={(e) => update(key, e.target.value.toUpperCase())} onBlur={() => finishEdit(`colour-${key}`, board[key], "Colour palette", `the ${label.toLowerCase()} colour direction`)} /> : <button type="button" className="emptyColourTrigger" onClick={() => document.getElementById(`hex-${key}`)?.focus()} aria-label={`Enter ${label} HEX`}>Empty</button>}<label><span>{label}</span><input id={`hex-${key}`} value={board[key]} placeholder="#000000" onFocus={() => beginEdit(`colour-${key}`, board[key])} onChange={(e) => update(key, e.target.value.toUpperCase())} onBlur={() => finishEdit(`colour-${key}`, board[key], "Colour palette", `the ${label.toLowerCase()} colour direction`)} maxLength={7} /></label><button type="button" disabled={!isValidHex(board[key])} onClick={() => navigator.clipboard.writeText(board[key])} aria-label={`Copy ${label} HEX`}>Copy</button></div>)}</div><div className="paletteFooter"><label>Optional palette rationale <span>{countWords(board.paletteRationale)} / 30 words</span><textarea rows={2} value={board.paletteRationale} onChange={(e) => update("paletteRationale", e.target.value)} placeholder="How does this palette support the direction?" /></label><button type="button" className="resetAction" disabled={colourFields.every(({ key }) => !board[key])} onClick={() => { const before = { primaryColour: board.primaryColour, secondaryColour1: board.secondaryColour1, secondaryColour2: board.secondaryColour2, accentColour: board.accentColour }; if (Object.values(before).every((value) => !value)) return; onChange({ ...board, ...emptyColours, confirmedSections: board.confirmedSections.filter((section) => section !== "palette") }); onEvent?.("Colour palette", "Cleared the colour palette.", { action: "Modify", source: "Human-initiated", eventType: "reset", beforeValue: before, afterValue: emptyColours, createDecision: true }); }}>Reset colours</button></div></div></Section>

        <Section id="typography" number="06" board={board} complete={completion.typography} onConfirm={() => confirm("typography")}><div className="typeDirectionFields"><label>Primary type style<select value={board.primaryTypeStyle} onChange={(e) => { const before = board.primaryTypeStyle; if (before === e.target.value) return; update("primaryTypeStyle", e.target.value); onEvent?.("Typography", `${before ? "Changed" : "Selected"} the primary typography direction${e.target.value ? ` to ${e.target.value}` : ""}.`, { action: before ? "Modify" : "Human-initiated", source: "Human-initiated", eventType: before ? "replacement" : "selection", beforeValue: before, afterValue: e.target.value, createDecision: true }); }}><option value="">Select direction</option>{typeStyles.map((style) => <option key={style}>{style}</option>)}</select></label><label>Secondary type style<select value={board.secondaryTypeStyle} onChange={(e) => { const before = board.secondaryTypeStyle; if (before === e.target.value) return; update("secondaryTypeStyle", e.target.value); onEvent?.("Typography", `${before ? "Changed" : "Selected"} the secondary typography direction${e.target.value ? ` to ${e.target.value}` : ""}.`, { action: before ? "Modify" : "Human-initiated", source: "Human-initiated", eventType: before ? "replacement" : "selection", beforeValue: before, afterValue: e.target.value, createDecision: true }); }}><option value="">Select direction</option>{typeStyles.map((style) => <option key={style}>{style}</option>)}</select></label></div><div className="typePreview"><strong style={{ fontFamily: fontStack(board.primaryTypeStyle) }}>Elsewhere</strong><span style={{ fontFamily: fontStack(board.secondaryTypeStyle) }}>Ordinary places, held in scent.</span><small>System-safe preview · direction only, not a final commercial font</small></div><p className="fieldLabel">Typography mood <span>{board.typographyMood.length} selected</span></p><ChipGroup options={typeMoods} selected={board.typographyMood} limit={3} label="Typography mood" onToggle={(value) => toggleLimited("typographyMood", value, 3, "Typography")} /><label className="compactTextField">Optional rationale <span>{countWords(board.typographyRationale)} / 30</span><textarea rows={2} value={board.typographyRationale} onChange={(e) => update("typographyRationale", e.target.value)} /></label></Section>

        <Section id="tone" number="07" board={board} complete={completion.tone} onConfirm={() => confirm("tone")}><div className="selectionMeta"><p>Select exactly three tone traits.</p><strong>{board.toneTraits.length} / 3 selected</strong></div><ChipGroup options={toneOptions} selected={board.toneTraits} limit={3} label="Tone of voice traits" onToggle={(value) => toggleLimited("toneTraits", value, 3, "Tone of voice")} /><label className="sampleLineField">How might Elsewhere speak?<textarea rows={2} value={board.sampleLine} onChange={(e) => update("sampleLine", e.target.value)} placeholder="Write one short example line…" /><span>{countWords(board.sampleLine)} / 20 words</span></label></Section>

        <Section id="logo" number="08" board={board} complete={completion.logo} onConfirm={() => confirm("logo")} incompleteMessage={logoIncompleteMessage}><div className="selectionMeta"><p>Add one generated image from Generated visuals, then describe the symbol direction.</p><strong>{board.selectedLogoImageId ? `${board.selectedLogoImageId} selected` : "Not yet selected"}</strong></div><div className="imageOptionGrid logoOptions">{logoImages.map((image) => <button type="button" key={image.id} className="imageOption selected" onClick={() => onSelectImage?.(image.id, "logo")}><ImagePlaceholder image={image} compact /><span><strong>{image.id}</strong>{image.label}</span><i>Remove from logo / symbol</i></button>)}{!logoImages.length && <div className="imageEmpty"><span>◇</span><p>No image has been added to this section. Choose one in Generated visuals.</p></div>}</div><label className="imageDirectionNote"><span><strong>Direction note</strong><i>{logoNoteCharacters} characters · minimum {MIN_IMAGE_DIRECTION_NOTE_CHARACTERS}</i></span><small>Briefly describe what should be retained, changed or developed in this direction.</small><textarea rows={4} value={board.logoDirectionNote} onChange={(e) => update("logoDirectionNote", e.target.value)} placeholder="Describe the direction…" /><em>{countWords(board.logoDirectionNote)} / 40 words</em></label></Section>

        <Section id="visuals" number="09" board={board} complete={completion.visuals} onConfirm={() => confirm("visuals")} incompleteMessage={visualsIncompleteMessage}><div className="selectionMeta"><p>Add one to three images from Generated visuals.</p><strong>{board.selectedVisualImageIds.length} / 3 selected</strong></div><div className="imageOptionGrid visualOptions">{visualImages.map((image) => { const note = board.visualReferenceNotes[image.id] ?? ""; return <div className="visualReference selected" key={image.id}><button type="button" onClick={() => onSelectImage?.(image.id, "visual")}><ImagePlaceholder image={image} compact /><span><strong>{image.id}</strong>Remove reference</span></button><label className="imageDirectionNote"><span><strong>Direction note</strong><i>{countNonWhitespaceCharacters(note.trim())} characters · minimum {MIN_IMAGE_DIRECTION_NOTE_CHARACTERS}</i></span><small>Briefly describe what should be retained, changed or developed in this direction.</small><textarea rows={4} aria-label={`Direction note for ${image.id}`} value={note} onChange={(e) => update("visualReferenceNotes", { ...board.visualReferenceNotes, [image.id]: e.target.value })} placeholder="Describe the direction…" /></label></div>; })}{!visualImages.length && <div className="imageEmpty"><span>▧</span><p>No images have been added to this section. Choose up to three in Generated visuals.</p></div>}</div>{board.selectedVisualImageIds.length > 0 && <p className="visualNoteRequirement">{validVisualNoteCount} / {board.selectedVisualImageIds.length} selected direction notes meet the minimum.</p>}</Section>

        <Section id="principles" number="10" board={board} complete={completion.principles} onConfirm={() => confirm("principles")}><p className="sectionHelper">Consolidate the visual choices into concise principles. Examples are guidance only.</p><div className="principleColumns"><fieldset><legend>DO <span>Retain</span></legend>{board.visualDos.map((value, index) => <label key={index}><span>{index + 1}</span><input value={value} onFocus={() => beginEdit(`do-${index}`, value)} onChange={(e) => { const next = [...board.visualDos]; next[index] = e.target.value; update("visualDos", next); }} onBlur={() => finishEdit(`do-${index}`, value, "Visual principles", `visual Do principle ${index + 1}`)} placeholder={index === 0 ? "e.g. Frame ordinary details" : "Add visual principle"} /><small>{countWords(value)} / 8</small></label>)}</fieldset><fieldset><legend>DON’T <span>Avoid</span></legend>{board.visualDonts.map((value, index) => <label key={index}><span>{index + 1}</span><input value={value} onFocus={() => beginEdit(`dont-${index}`, value)} onChange={(e) => { const next = [...board.visualDonts]; next[index] = e.target.value; update("visualDonts", next); }} onBlur={() => finishEdit(`dont-${index}`, value, "Visual principles", `visual Don’t principle ${index + 1}`)} placeholder={index === 0 ? "e.g. Use luxury perfume clichés" : "Add direction to avoid"} /><small>{countWords(value)} / 8</small></label>)}</fieldset></div></Section>

        <Section id="rationale" number="11" board={board} complete={completion.rationale} onConfirm={() => confirm("rationale")}><p className="sectionHelper">Explain how the selected concept, tone, typography, colours, logo direction and visual references work together. Add at least {MIN_FINAL_RATIONALE_CHARACTERS} characters.</p><label className="editorialField"><textarea rows={5} value={board.rationale} onChange={(e) => update("rationale", e.target.value)} placeholder="Bring the complete direction together…" /><span className={countWords(board.rationale) > 80 || (countNonWhitespaceCharacters(board.rationale) > 0 && countNonWhitespaceCharacters(board.rationale) < MIN_FINAL_RATIONALE_CHARACTERS) ? "limitOver" : ""}>{countNonWhitespaceCharacters(board.rationale)} characters · minimum {MIN_FINAL_RATIONALE_CHARACTERS} · {countWords(board.rationale)} / 80 words</span></label><div className="completionSummary"><div><span>Direction completion</span><strong>Required {progress.requiredComplete} of 8 · All {progress.allComplete} of 11</strong><div><i style={{ width: `${(progress.requiredComplete / 8) * 100}%` }} /></div></div>{onSubmit && !submitted && <button type="button" className="primaryButton" onClick={onSubmit}>Submit final direction →</button>}{submitted && <span className="submittedState">Final direction submitted ✓</span>}</div></Section>
      </div></BoardSectionContext.Provider>
    </section>
  );
}
