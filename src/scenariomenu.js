// The scenario picker: which fight, your aircraft, theirs, how it starts and how good their pilots are. Its
// choices go into the link and the page reloads into the scenario (scenario.js: everything is set up from it).
import { SCENARIOS, PLANES, SIDE, STARTS, SKILLS, defaultFoe, scenarioLink } from './scenario.js';

const KEY = 'bomber.scenarioPick';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

/** Show the picker in the menu (ui.menu). back: what Back does. */
export function showScenarios(ui, back) {
  const pick = { id: 'duel', me: 'p47', foe: null, start: 'merge', skill: 'veteran', ...remembered() };
  if (!SCENARIOS[pick.id]) pick.id = 'duel';
  const render = () => {
    if (SIDE[pick.foe] === SIDE[pick.me] || !PLANES[pick.foe]) pick.foe = defaultFoe(pick.me);
    const def = SCENARIOS[pick.id];
    const group = (title, key, items, note = '') => `<div class="scn-group"><h4>${title}</h4><div class="scn-opts">${
      items.map(([id, label, sub]) => `<button class="scn-opt${pick[key] === id ? ' on' : ''}" data-k="${key}" data-v="${id}"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>`).join('')
    }</div>${note ? `<p class="scn-note">${esc(note)}</p>` : ''}</div>`;
    const foes = Object.keys(PLANES).filter((k) => SIDE[k] !== SIDE[pick.me]);
    const body = `<div class="scn">${
      group('The fight', 'id', Object.entries(SCENARIOS).map(([id, s]) => [id, s.label, s.blurb]))
    }${group('Your aircraft', 'me', Object.entries(PLANES).map(([id, n]) => [id, n, SIDE[id] === 'axis' ? 'Luftwaffe' : 'USAAF']))
    }${def.raid ? '' : group('Theirs', 'foe', foes.map((id) => [id, PLANES[id]]), foes.length < 2 ? 'The Thunderbolt is the only American fighter here.' : '')
    }${def.raid ? '' : group('How it starts', 'start', Object.entries(STARTS).map(([id, s]) => [id, s.label, s.blurb]))
    }${def.raid ? '' : group('Their pilots', 'skill', Object.entries(SKILLS).map(([id, s]) => [id, s.label]))}</div>`;
    ui.menu({
      kind: 'roles', kicker: 'Fighter scenarios', title: 'Pick a fight', stamp: 'Training',
      text: 'Smaller fights than the raid, flown with the same aircraft, guns and flight model. Their pilots fly the basic fighter manoeuvres: break turns, yo-yos, scissors, the Split-S and the Immelmann, boom and zoom.',
      body, button: 'Fly', onClick: () => {
        try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch { /* (no storage) */ }
        location.href = scenarioLink(pick);
      },
      actions: back ? [{ label: 'Back', onClick: back }] : [],
      hint: 'The page reloads into the fight',
    });
    for (const b of document.querySelectorAll('#menu-body .scn-opt')) b.onclick = () => { pick[b.dataset.k] = b.dataset.v; render(); };
  };
  render();
}
