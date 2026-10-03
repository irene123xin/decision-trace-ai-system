"use client";

import { useMemo, useState } from "react";
import {
  automatedUnitsForMessage,
  compareAutomatedWithHuman,
  compareHumanCoders,
  adjudicateCodingRecord,
  anonymisedSessionId,
  ensureHumanCodingRecords,
  getConversationParticipantMessages,
} from "@/services/pilotCodingService";
import type { HumanCodedUnit, MessageHumanCoding, Session } from "@/types";

interface Props { session: Session; onChange: (session: Session) => void; }
type CoderKey = "coder1" | "coder2";
type Filter = "uncoded" | "disagreement" | "uncertain" | "classifier_failure" | "low_confidence" | "multiple_units" | "all";
const categories: HumanCodedUnit["category"][] = ["accept", "modify", "reject", "human_initiated", "uncertain", "no_decision"];

const newUnit = (messageId: string, index: number): HumanCodedUnit => ({ id: `HC-${messageId}-${index + 1}`, category: "uncertain", evidenceText: "", neutralSummary: "", linkedAiMessageId: null, linkedAiPropositionId: null, coderNote: null });

export function PilotCodingPanel({ session, onChange }: Props) {
  const messages = useMemo(() => getConversationParticipantMessages(session), [session]);
  const records = useMemo(() => ensureHumanCodingRecords(session), [session]);
  const [coderKey, setCoderKey] = useState<CoderKey>("coder1");
  const [filter, setFilter] = useState<Filter>("uncoded");
  const [selectedMessageId, setSelectedMessageId] = useState(messages[0]?.id ?? "");
  const [revealedAutomated, setRevealedAutomated] = useState<Set<string>>(new Set());
  const [revealedOther, setRevealedOther] = useState<Set<string>>(new Set());

  const saveRecords = (nextRecords: MessageHumanCoding[]) => onChange({ ...session, humanCoding: nextRecords });
  const updateRecord = (messageId: string, transform: (record: MessageHumanCoding) => MessageHumanCoding) => saveRecords(records.map((record) => record.participantMessageId === messageId ? transform(record) : record));
  const updateCoder = (messageId: string, transform: (coder: MessageHumanCoding[CoderKey]) => MessageHumanCoding[CoderKey]) => updateRecord(messageId, (record) => ({ ...record, [coderKey]: transform(record[coderKey]) }));

  const filtered = messages.filter((message) => {
    const record = records.find((item) => item.participantMessageId === message.id)!;
    const coder = record[coderKey];
    const automated = automatedUnitsForMessage(session, message.id);
    const comparison = coder.status === "coded" ? compareAutomatedWithHuman(automated, coder.units) : null;
    if (filter === "uncoded") return coder.status === "not_coded";
    if (filter === "disagreement") return Boolean(comparison && !["exact_agreement", "partial_agreement"].includes(comparison.result));
    if (filter === "uncertain") return coder.units.some((unit) => unit.category === "uncertain") || automated.some((unit) => unit.category === "uncertain");
    if (filter === "classifier_failure") return (session.traceClassifications ?? []).some((item) => item.participantMessageId === message.id && ["TRACE_PROVIDER_ERROR", "TRACE_SCHEMA_ERROR", "TRACE_CONTEXT_ERROR"].includes(item.status));
    if (filter === "low_confidence") return automated.some((unit) => typeof unit.confidenceScore === "number" && unit.confidenceScore < 0.8);
    if (filter === "multiple_units") return automated.length > 1 || coder.units.filter((unit) => unit.category !== "no_decision").length > 1;
    return true;
  });
  const activeMessage = filtered.find((message) => message.id === selectedMessageId) ?? filtered[0] ?? messages[0];
  const activeRecord = records.find((record) => record.participantMessageId === activeMessage?.id);
  const activeCoder = activeRecord?.[coderKey];
  const otherKey: CoderKey = coderKey === "coder1" ? "coder2" : "coder1";
  const otherCoder = activeRecord?.[otherKey];
  const automated = activeMessage ? automatedUnitsForMessage(session, activeMessage.id) : [];
  const relevantPropositions = activeMessage ? (session.aiPropositions ?? []).filter((proposition) => new Date(proposition.createdAt).getTime() <= new Date(activeMessage.createdAt).getTime()) : [];
  const precedingContext = activeMessage ? session.messages.filter((message) => message.createdAt <= activeMessage.createdAt && message.id !== activeMessage.id).slice(-4) : [];
  const codedCount = records.filter((record) => record[coderKey].status === "coded").length;

  const revealAutomated = () => {
    if (!activeMessage || !activeCoder) return;
    setRevealedAutomated((current) => new Set(current).add(activeMessage.id));
    if (activeCoder.status !== "coded") updateCoder(activeMessage.id, (coder) => ({ ...coder, automatedCodingRevealedBeforeSubmission: true }));
  };
  const saveAndNext = () => {
    if (!activeMessage || !activeCoder || !activeCoder.coderId?.trim() || !activeCoder.units.length) return;
    const valid = activeCoder.units.every((unit) => unit.category === "no_decision" || (unit.evidenceText.trim() && unit.neutralSummary.trim()));
    if (!valid) return;
    updateRecord(activeMessage.id, (record) => {
      const updated = { ...record, [coderKey]: { ...record[coderKey], status: "coded" as const, codedAt: new Date().toISOString() } };
      if (updated.coder1.status === "coded" && updated.coder2.status === "coded") {
        const comparison = compareHumanCoders(updated.coder1.units, updated.coder2.units);
        updated.adjudication = { ...updated.adjudication, status: comparison.result === "exact_agreement" || comparison.result === "partial_agreement" ? "not_required" : "pending" };
      }
      return updated;
    });
    const currentIndex = filtered.findIndex((message) => message.id === activeMessage.id);
    setSelectedMessageId(filtered[currentIndex + 1]?.id ?? activeMessage.id);
  };

  const resolveAdjudication = (source: "coder1" | "coder2" | "automated" | "revised", status: "resolved" | "pending" = "resolved") => {
    if (!activeMessage || !activeRecord) return;
    const fromAutomated: HumanCodedUnit[] = automated.map((unit, index) => ({ id: `ADJ-${activeMessage.id}-${index + 1}`, category: unit.originalModelCategory ?? unit.category ?? "uncertain", evidenceText: unit.evidenceText ?? "", neutralSummary: unit.originalModelLabel.summary, linkedAiMessageId: unit.linkedAiMessageIds?.[0] ?? null, linkedAiPropositionId: unit.linkedAiPropositionIds?.[0] ?? null }));
    const units = source === "automated" ? fromAutomated : source === "revised" ? activeRecord.coder1.units.map((unit, index) => ({ ...unit, id: `ADJ-${activeMessage.id}-${index + 1}` })) : activeRecord[source].units.map((unit) => ({ ...unit }));
    updateRecord(activeMessage.id, (record) => status === "resolved" ? adjudicateCodingRecord(record, units, session.researcherId) : ({ ...record, adjudication: { ...record.adjudication, status: "pending", resolvedUnits: source === "revised" ? units : record.adjudication.resolvedUnits, resolvedAt: null, resolvedBy: null } }));
  };

  return <section className="researchSection pilotCodingPanel">
    <div className="researchSectionTitle"><div><p className="eyebrow">METHOD VALIDATION</p><h2>Pilot coding</h2></div><span>{codedCount} of {messages.length} messages coded</span></div>
    <p className="methodNote">Decision Trace is a computational coding of observable conversation behaviour. It does not directly measure a participant’s internal mental state.</p>
    <div className="codingToolbar"><label>Coder<select value={coderKey} onChange={(event) => setCoderKey(event.target.value as CoderKey)}><option value="coder1">Coder 1</option><option value="coder2">Coder 2</option></select></label><label>Filter<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>{["uncoded", "disagreement", "uncertain", "classifier_failure", "low_confidence", "multiple_units", "all"].map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label>Message<select value={activeMessage?.id ?? ""} onChange={(event) => setSelectedMessageId(event.target.value)}>{filtered.map((message) => <option value={message.id} key={message.id}>Turn {message.turn} · {message.id}</option>)}</select></label></div>
    {!activeMessage || !activeRecord || !activeCoder ? <p className="emptyNote">No participant conversation messages match this filter.</p> : <div className="codingWorkspace">
      <header><span>Coded session {anonymisedSessionId(session.id)} · Turn {activeMessage.turn}</span><time>{new Date(activeMessage.createdAt).toLocaleString("en-GB")}</time></header>
      <div className="codingContext"><p className="eyebrow">NECESSARY CONTEXT</p>{precedingContext.map((message) => <article key={message.id}><strong>{message.role === "assistant" ? "AI response" : "Participant"} · {message.id}</strong><p>{message.content}</p></article>)}</div>
      <blockquote className="codingMessage">{activeMessage.content}</blockquote>
      <label className="coderIdentity">Coder ID<input value={activeCoder.coderId ?? ""} onChange={(event) => updateCoder(activeMessage.id, (coder) => ({ ...coder, coderId: event.target.value }))} placeholder="Coded researcher ID" /></label>
      <div className="humanUnitList">{activeCoder.units.map((unit, index) => <article key={unit.id}>
        <header><strong>Unit {index + 1}</strong><button type="button" onClick={() => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: coder.units.filter((item) => item.id !== unit.id) }))}>Remove</button></header>
        <label>Category<select value={unit.category} onChange={(event) => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: coder.units.map((item) => item.id === unit.id ? { ...item, category: event.target.value as HumanCodedUnit["category"] } : item) }))}>{categories.map((category) => <option value={category} key={category}>{category.replaceAll("_", " ")}</option>)}</select></label>
        <label>Exact evidence<textarea value={unit.evidenceText} onChange={(event) => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: coder.units.map((item) => item.id === unit.id ? { ...item, evidenceText: event.target.value } : item) }))} /></label>
        <label>Neutral summary<textarea value={unit.neutralSummary} onChange={(event) => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: coder.units.map((item) => item.id === unit.id ? { ...item, neutralSummary: event.target.value } : item) }))} /></label>
        <label>Linked AI proposition<select value={unit.linkedAiPropositionId ?? ""} onChange={(event) => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: coder.units.map((item) => item.id === unit.id ? { ...item, linkedAiPropositionId: event.target.value || null, linkedAiMessageId: relevantPropositions.find((proposition) => proposition.id === event.target.value)?.aiMessageId ?? null } : item) }))}><option value="">None / unresolved</option>{relevantPropositions.map((proposition) => <option value={proposition.id} key={proposition.id}>{proposition.id} · {proposition.summary}</option>)}</select></label>
      </article>)}</div>
      <div className="codingActions"><button type="button" onClick={() => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: [{ ...newUnit(activeMessage.id, 0), category: "no_decision", neutralSummary: "No actionable design decision identified." }] }))}>No decision</button><button type="button" onClick={() => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: [...coder.units, newUnit(activeMessage.id, coder.units.length)] }))}>Add decision unit</button><button type="button" onClick={() => updateCoder(activeMessage.id, (coder) => ({ ...coder, units: [...coder.units, { ...newUnit(activeMessage.id, coder.units.length), category: "uncertain" }] }))}>Mark uncertain</button><button type="button" onClick={saveAndNext}>Save and move to next</button></div>
      <label className="codingNote">Optional coder note<textarea value={activeCoder.note ?? ""} onChange={(event) => updateCoder(activeMessage.id, (coder) => ({ ...coder, note: event.target.value || null }))} /></label>
      <div className="codingReveal"><button type="button" onClick={revealAutomated} disabled={coderKey === "coder2" && activeCoder.status !== "coded"}>Reveal automated coding</button>{coderKey === "coder2" && activeCoder.status !== "coded" && <small>Available after Coder 2 coding is saved.</small>}{activeCoder.status === "coded" && otherCoder?.status === "coded" && <button type="button" onClick={() => setRevealedOther((current) => new Set(current).add(activeMessage.id))}>Reveal {otherKey === "coder1" ? "coder 1" : "coder 2"}</button>}</div>
      {(activeCoder.status === "coded" || revealedAutomated.has(activeMessage.id)) && <section className="codingComparison"><h3>Automatic vs {coderKey === "coder1" ? "Coder 1" : "Coder 2"}</h3><strong>{compareAutomatedWithHuman(automated, activeCoder.units).result.replaceAll("_", " ")}</strong>{automated.map((unit) => <p key={unit.id}>{unit.originalModelCategory ?? unit.category} · {unit.originalModelLabel.summary} · {unit.confidenceScore ?? unit.confidence}</p>)}</section>}
      {revealedOther.has(activeMessage.id) && otherCoder?.status === "coded" && <section className="codingComparison"><h3>Coder 1 vs Coder 2</h3><strong>{compareHumanCoders(activeRecord.coder1.units, activeRecord.coder2.units).result.replaceAll("_", " ")}</strong>{otherCoder.units.map((unit) => <p key={unit.id}>{unit.category} · {unit.neutralSummary}</p>)}</section>}
      {activeRecord.adjudication.status === "pending" && <section className="adjudicationPanel"><h3>Adjudication</h3><div><button onClick={() => resolveAdjudication("coder1")}>Accept coder 1</button><button onClick={() => resolveAdjudication("coder2")}>Accept coder 2</button><button onClick={() => resolveAdjudication("automated")}>Accept automated coding</button><button onClick={() => resolveAdjudication("revised", "pending")}>Create revised coding</button><button onClick={() => updateRecord(activeMessage.id, (record) => ({ ...record, adjudication: { ...record.adjudication, status: "pending", resolvedAt: null, resolvedBy: null } }))}>Mark unresolved</button></div>{activeRecord.adjudication.resolvedUnits.length > 0 && <div className="adjudicationUnits">{activeRecord.adjudication.resolvedUnits.map((unit) => <article key={unit.id}><label>Resolved category<select value={unit.category} onChange={(event) => updateRecord(activeMessage.id, (record) => ({ ...record, adjudication: { ...record.adjudication, resolvedUnits: record.adjudication.resolvedUnits.map((item) => item.id === unit.id ? { ...item, category: event.target.value as HumanCodedUnit["category"] } : item) } }))}>{categories.map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}</select></label><label>Evidence<textarea value={unit.evidenceText} onChange={(event) => updateRecord(activeMessage.id, (record) => ({ ...record, adjudication: { ...record.adjudication, resolvedUnits: record.adjudication.resolvedUnits.map((item) => item.id === unit.id ? { ...item, evidenceText: event.target.value } : item) } }))} /></label><label>Neutral summary<textarea value={unit.neutralSummary} onChange={(event) => updateRecord(activeMessage.id, (record) => ({ ...record, adjudication: { ...record.adjudication, resolvedUnits: record.adjudication.resolvedUnits.map((item) => item.id === unit.id ? { ...item, neutralSummary: event.target.value } : item) } }))} /></label></article>)}</div>}<label>Rationale<textarea value={activeRecord.adjudication.note ?? ""} onChange={(event) => updateRecord(activeMessage.id, (record) => ({ ...record, adjudication: { ...record.adjudication, note: event.target.value || null } }))} /></label>{activeRecord.adjudication.resolvedUnits.length > 0 && <button type="button" onClick={() => updateRecord(activeMessage.id, (record) => adjudicateCodingRecord(record, record.adjudication.resolvedUnits, session.researcherId))}>Save revised resolution</button>}</section>}
    </div>}
  </section>;
}
