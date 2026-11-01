// The open connections: who is connected, sending to them, and the message
// throttle every connection goes through.


/** connId -> {ws, gameId, playerId} */
export const conns = new Map();

export function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/** Every open connection of an account. */
export function connsOf(key) {
  return [...conns.values()].filter(other => other.accountKey === key);
}

// Message throttle per connection (token bucket). Generous for people - the
// UI sends at most a few messages per second, sliders are throttled - but a
// script flooding the server would slow the game down for everyone.
export const RATE = { burst: 40, perSecond: 20, dropsBeforeClose: 200 };
export function allowMessage(c) {
  const now = Date.now();
  c.tokens = Math.min(RATE.burst, (c.tokens ?? RATE.burst) + (now - (c.refilled ?? now)) / 1000 * RATE.perSecond);
  c.refilled = now;
  if (c.tokens >= 1) { c.tokens--; return true; }
  c.dropped = (c.dropped || 0) + 1;
  return false;
}
