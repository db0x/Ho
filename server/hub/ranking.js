// The ranking of this instance: on request, computed from the statistics
// of all games opened in the lobby (server/stats.js). Only with sign-in -
// without accounts there is nobody a rating could belong to.
import { authEnabled } from '../auth.js';
import { ranking } from '../stats.js';
import { send } from './connections.js';

export const rankingHandlers = {
  ranking({ c, ws }) {
    if (!authEnabled()) return;
    let r;
    try { r = ranking(c.accountKey); } catch (e) {
      console.error('Ranking failed:', e.message);
      return send(ws, { t: 'error', key: 'err.server', params: { detail: e.message } });
    }
    send(ws, { t: 'ranking', ...r });
  }
};
