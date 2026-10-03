export const PARTICIPANT_TAB_LOCK_PREFIX = "decision-trace-participant-tab-v1:";
export const PARTICIPANT_TAB_LOCK_TTL_MS = 7_000;
export const PARTICIPANT_TAB_HEARTBEAT_MS = 2_000;

interface LockRecord { ownerId: string; expiresAt: number; }

function parseLock(value: string | null): LockRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LockRecord>;
    return typeof parsed.ownerId === "string" && typeof parsed.expiresAt === "number" ? parsed as LockRecord : null;
  } catch { return null; }
}

export function canClaimParticipantTabLock(value: string | null, ownerId: string, now = Date.now()): boolean {
  const current = parseLock(value);
  return !current || current.ownerId === ownerId || current.expiresAt <= now;
}

export interface ParticipantTabLockHandle { release: () => void; }

export function coordinateParticipantTab(
  sessionId: string,
  onOwnershipChange: (active: boolean) => void,
): ParticipantTabLockHandle {
  const key = `${PARTICIPANT_TAB_LOCK_PREFIX}${sessionId}`;
  const ownerId = crypto.randomUUID();
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(key);
  let active = false;
  let initialized = false;

  const publish = () => channel?.postMessage({ type: "participant-tab-lock-updated" });
  const claim = () => {
    const now = Date.now();
    if (!canClaimParticipantTabLock(window.localStorage.getItem(key), ownerId, now)) {
      if (active || !initialized) { active = false; initialized = true; onOwnershipChange(false); }
      return;
    }
    window.localStorage.setItem(key, JSON.stringify({ ownerId, expiresAt: now + PARTICIPANT_TAB_LOCK_TTL_MS }));
    const confirmed = parseLock(window.localStorage.getItem(key))?.ownerId === ownerId;
    if (confirmed !== active || !initialized) { active = confirmed; initialized = true; onOwnershipChange(confirmed); }
    if (confirmed) publish();
  };
  const release = () => {
    const current = parseLock(window.localStorage.getItem(key));
    if (current?.ownerId === ownerId) window.localStorage.removeItem(key);
    active = false;
    publish();
  };
  const check = () => claim();
  const storage = (event: StorageEvent) => { if (event.key === key) check(); };
  window.addEventListener("storage", storage);
  window.addEventListener("pagehide", release);
  if (channel) channel.onmessage = check;
  claim();
  const heartbeat = window.setInterval(claim, PARTICIPANT_TAB_HEARTBEAT_MS);
  return { release: () => {
    window.clearInterval(heartbeat);
    window.removeEventListener("storage", storage);
    window.removeEventListener("pagehide", release);
    release();
    channel?.close();
  } };
}
