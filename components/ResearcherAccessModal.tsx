"use client";

import { useState } from "react";

interface Props {
  onCancel: () => void;
  onSuccess: () => void;
}

export function ResearcherAccessModal({ onCancel, onSuccess }: Props) {
  const [pin, setPin] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setInvalid(false);
    try {
      const response = await fetch("/api/researcher-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        setInvalid(true);
        return;
      }
      setPin("");
      onSuccess();
    } catch {
      setInvalid(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modalBackdrop">
      <section className="researcherAccessModal" role="dialog" aria-modal="true" aria-labelledby="researcher-access-modal-title">
        <p className="eyebrow">PRIVATE CONTROL</p>
        <h2 id="researcher-access-modal-title">Researcher access</h2>
        <p>Enter the locally configured PIN to continue with this action.</p>
        <form onSubmit={submit}>
          <label htmlFor="researcher-action-pin">PIN</label>
          <input id="researcher-action-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} required autoFocus />
          {invalid && <p className="researcherAccessMessage" role="status">The PIN was not recognised. Please try again.</p>}
          <div><button type="button" onClick={onCancel} disabled={submitting}>Cancel</button><button className="primaryButton" type="submit" disabled={submitting}>{submitting ? "Checking…" : "Continue"}</button></div>
        </form>
      </section>
    </div>
  );
}
