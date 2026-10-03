import type { DecisionAction, DecisionUnit } from "@/types";
import { getParticipantVisibleDecisions } from "@/services/decisionTraceClassifier";
import { buildDecisionTraceTurnGroups, getCurrentDecisionGroup, participantDecisionLabel, traceActionClass } from "@/services/decisionTracePresentation";

const actions: DecisionAction[] = ["Accept", "Modify", "Reject", "Human-initiated"];

function timecode(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const turnLabel = (turn: number | null) => turn && turn > 0 ? `Turn ${String(turn).padStart(2, "0")}` : "Board interaction";

function CategoryMark({ action }: { action: DecisionAction }) {
  return <i className={`categoryMark ${traceActionClass(action)}`} aria-hidden="true" />;
}

export function DecisionTrace({ decisions, pending = false }: { decisions: DecisionUnit[]; pending?: boolean }) {
  const visibleDecisions = getParticipantVisibleDecisions(decisions);
  const currentDecisions = getCurrentDecisionGroup(visibleDecisions);
  const groups = buildDecisionTraceTurnGroups(visibleDecisions);
  return (
    <aside className="tracePanel" aria-label="Decision Trace">
      <div className="panelHeader traceHeader">
        <h2>Decision Trace</h2>
        <div className="traceStatus"><span className="livePill"><i /> Live</span>{pending && <span className="traceUpdating" role="status" aria-live="polite">Updating…</span>}</div>
      </div>
      <p className="traceIntro">A live record of design choices expressed in this conversation.</p>

      <section className="currentDecision">
        <p className="eyebrow">CURRENT DECISION</p>
        {currentDecisions.length ? <div className="currentDecisionStack">{currentDecisions.map((current) => (
          <article className={`currentDecisionCard ${traceActionClass(current.finalReviewedLabel.action)}`} key={current.id}>
            <span className={`actionTag ${traceActionClass(current.finalReviewedLabel.action)}`}><CategoryMark action={current.finalReviewedLabel.action} />{participantDecisionLabel(current.finalReviewedLabel.action)}</span>
            <p className="currentSummary">{current.finalReviewedLabel.summary}</p>
            {current.evidenceText && <blockquote className="traceEvidence">“{current.evidenceText}”</blockquote>}
            <small>{turnLabel(current.relatedTurn)} · {timecode(current.timestampSeconds)}</small>
          </article>
        ))}</div> : <div className="traceEmpty"><p>No clear design decision has been recorded yet.</p></div>}
      </section>

      <section className="patternSection">
        <p className="eyebrow">DECISION PATTERN</p>
        <div className="patternGrid">{actions.map((action) => <div className={traceActionClass(action)} key={action}><CategoryMark action={action} /><strong>{visibleDecisions.filter((d) => d.finalReviewedLabel.action === action).length}</strong><span>{participantDecisionLabel(action)}</span></div>)}</div>
      </section>

      <section className="timelineSection">
        <div className="timelineTitle"><p className="eyebrow">DECISION TIMELINE</p><span>{visibleDecisions.length} recorded</span></div>
        <div className="timeline">
          {groups.map((group, groupIndex) => <section className="timelineTurnGroup" key={group.key}>
            <header><strong>{turnLabel(group.turn)}</strong><span>{group.decisions.length} {group.decisions.length === 1 ? "decision" : "decisions"}</span></header>
            {group.decisions.map((decision, decisionIndex) => (
              <article className={groupIndex === groups.length - 1 && decisionIndex === group.decisions.length - 1 ? `timelineCard recent ${traceActionClass(decision.finalReviewedLabel.action)}` : `timelineCard ${traceActionClass(decision.finalReviewedLabel.action)}`} key={decision.id}>
                <div className="timelineRail"><CategoryMark action={decision.finalReviewedLabel.action} /><span /></div>
                <div><span className={`actionTag ${traceActionClass(decision.finalReviewedLabel.action)}`}>{participantDecisionLabel(decision.finalReviewedLabel.action)}</span><p>{decision.finalReviewedLabel.summary}</p><small>{timecode(decision.timestampSeconds)}</small></div>
              </article>
            ))}
          </section>)}
        </div>
      </section>
    </aside>
  );
}
