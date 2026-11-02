// What others may see of an account - two switches below the friends:
// the online status for friends, and the line in the ranking. The server
// keeps them with the account, so they apply on every device.
import { refreshRanking } from './ranking.js';

const $ = s => document.querySelector(s);
let send = null;

/** From the hello: only accounts have something to hide. */
export function bindPrivacy(privacy, sendFn) {
  send = sendFn;
  $('#privacy-box').classList.toggle('hidden', !privacy);
  if (!privacy) return;
  showPrivacy(privacy);
  $('#privacy-status').onchange = (e) => send({ t: 'privacy', status: e.target.checked });
  $('#privacy-ranking').onchange = (e) => send({ t: 'privacy', ranking: e.target.checked });
}

/** The state as the server has it - after a change, on every device. */
export function showPrivacy(privacy) {
  const before = $('#privacy-ranking').checked;
  $('#privacy-status').checked = privacy.status;
  $('#privacy-ranking').checked = privacy.ranking;
  if (before !== privacy.ranking) refreshRanking();
}
