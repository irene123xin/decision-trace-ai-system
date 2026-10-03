import { DEFAULT_TASK_DURATION_MINUTES, ELSEWHERE_BRIEF } from "@/data/experiment";

const requiredAreas = ["Brand concept", "Six brand keywords", "Brand personality", "Audience interpretation", "Four-colour palette", "Logo / symbol direction", "Visual style references", "Final rationale"];
const supportingAreas = ["Typography direction", "Tone of voice", "Visual do’s and don’ts"];

export function BriefPanel({ compact = false, durationMinutes = DEFAULT_TASK_DURATION_MINUTES }: { compact?: boolean; durationMinutes?: number }) {
  return (
    <section className={compact ? "briefPanel compact" : "briefPanel"}>
      <div className="panelTitleRow">
        <div><p className="eyebrow">TASK BRIEF · {ELSEWHERE_BRIEF.category}</p><h2>{ELSEWHERE_BRIEF.title}</h2></div>
        <span className="statusPill">{durationMinutes} min</span>
      </div>
      <p><strong>Task</strong><br />{ELSEWHERE_BRIEF.task}</p>
      <p className="fixedNameNote">{ELSEWHERE_BRIEF.fixedNameNote}</p>
      <p><strong>Brand context</strong><br />{ELSEWHERE_BRIEF.context}</p>
      <p>{ELSEWHERE_BRIEF.positioning}</p>
      <p><strong>Audience</strong><br />{ELSEWHERE_BRIEF.audience}</p>
      <p><strong>Output</strong><br />{ELSEWHERE_BRIEF.output}</p>
      <div className="deliverables"><p className="eyebrow">WORKING BOARD AREAS</p><div className="briefAreaGroups"><div><strong>Required</strong><ol>{requiredAreas.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ol></div><div><strong>Supporting</strong><ol>{supportingAreas.map((item, index) => <li key={item}><span>{String(index + 9).padStart(2, "0")}</span>{item}</li>)}</ol></div></div></div>
    </section>
  );
}
