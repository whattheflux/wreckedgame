import {
  CLASSES,
  ATTRS,
  ATTR_IDS,
  CLIQUES,
  FIELD_SIZE,
  PERKS,
  WEAPONS,
  chooseSquad,
  effectiveStats,
  newMember,
  type Clique,
  type Look,
  type PlayerChoice,
  type RosterMember,
  type SchoolClass,
} from '../engine';

import { previewUrl } from '../render/sprites';

/** Full-stage overlay screens: title, character creation, and squad pick. Plain DOM, no state beyond the screen itself. */

const overlay = document.getElementById('overlay') as HTMLDivElement;

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const overlayOpen = (): boolean => !overlay.hidden;

export function hideOverlay(): void {
  overlay.hidden = true;
  overlay.innerHTML = '';
}

function show(html: string): HTMLDivElement {
  overlay.innerHTML = `<div class="card">${html}</div>`;
  overlay.hidden = false;
  return overlay.firstElementChild as HTMLDivElement;
}

/** For other screens (inventory, spoils) that build their own card. */
export const showCard = (html: string): HTMLDivElement => show(html);
export const hideOverlayCard = hideOverlay;

const statLine = (m: RosterMember): string => {
  const s = effectiveStats(m);
  return (
    `HP ${s.hp} &middot; Move ${s.mobility} &middot; Crit ${s.crit}% &middot; Sight ${s.sight}<br>` +
    `Ranged ${s.rangedAim} atk / ${s.rangedDefense} def &middot; Melee ${s.meleeAim} atk / ${s.meleeDefense} def`
  );
};

/** The seven attributes on one line, for the creation preview. */
const attrLine = (m: RosterMember): string => ATTR_IDS.map((id) => `${ATTRS[id].letter} ${m.attributes[id]}`).join(' &middot; ');

/** What this clique and class already know how to do. */
const perkLineFor = (m: RosterMember): string => m.perks.map((id) => PERKS[id]?.name ?? id).join(', ');

const weaponLine = (m: RosterMember): string => {
  const w = WEAPONS[m.weapon];
  return `${w.name} ${w.damage[0]}-${w.damage[1]} dmg, range ${w.range}`;
};

export function showTitle(opts: { canContinue: boolean; onContinue: () => void; onNew: () => void }): void {
  const card = show(
    `<h1>Wrecked</h1><p class="sub">The ship is on the rocks. The island is full of other kids, and not all of them are friendly.</p>` +
      `<div class="row">${opts.canContinue ? '<button id="ov-continue" class="primary">Continue</button>' : ''}<button id="ov-new"${opts.canContinue ? '' : ' class="primary"'}>New game</button></div>`,
  );
  card.querySelector('#ov-continue')?.addEventListener('click', opts.onContinue);
  card.querySelector('#ov-new')?.addEventListener('click', opts.onNew);
}

export function showCreate(onDone: (choice: PlayerChoice) => void, initial: Partial<PlayerChoice> = {}): void {
  let look: Look = initial.look ?? 'male';
  let clique: Clique = initial.clique ?? 'popular';
  let schoolClass: SchoolClass = initial.schoolClass ?? 'sport';
  const cliques = Object.keys(CLIQUES) as Clique[];
  const classes = Object.keys(CLASSES) as SchoolClass[];

  const card = show(
    `<h1>Who are you?</h1>` +
      `<p class="sub">Pick your clique and what you studied. Any combination works.</p>` +
      `<label class="field">Name <input id="ov-name" maxlength="16" value="${esc(initial.name ?? '')}" placeholder="Your name" autocomplete="off"></label>` +
      `<h3>Look</h3><div class="grid looks" id="ov-looks">${(['male', 'female'] as Look[])
        .map((l) => {
          const url = previewUrl(`pc-${l}`);
          return `<button class="choice look" data-v="${l}">${url ? `<img src="${url}" alt="" width="64" height="64">` : ''}<b>${l === 'male' ? 'Boy' : 'Girl'}</b></button>`;
        })
        .join('')}</div>` +
      `<h3>Clique</h3><div class="grid" id="ov-cliques">${cliques
        .map((c) => `<button class="choice" data-v="${c}"><b>${CLIQUES[c].label}</b><span>${esc(CLIQUES[c].blurb)}</span></button>`)
        .join('')}</div>` +
      `<h3>Class</h3><div class="grid" id="ov-classes">${classes
        .map((c) => `<button class="choice" data-v="${c}"><b>${CLASSES[c].label}</b><span>${esc(CLASSES[c].blurb)}</span></button>`)
        .join('')}</div>` +
      `<div id="ov-preview" class="preview"></div>` +
      `<div class="row"><button id="ov-start" class="primary">Wash ashore</button></div>`,
  );
  const nameEl = card.querySelector('#ov-name') as HTMLInputElement;

  const refresh = (): void => {
    card.querySelectorAll<HTMLButtonElement>('#ov-looks .choice').forEach((b) => b.classList.toggle('selected', b.dataset.v === look));
    card.querySelectorAll<HTMLButtonElement>('#ov-cliques .choice').forEach((b) => b.classList.toggle('selected', b.dataset.v === clique));
    card.querySelectorAll<HTMLButtonElement>('#ov-classes .choice').forEach((b) => b.classList.toggle('selected', b.dataset.v === schoolClass));
    const m = newMember('pc', nameEl.value.trim() || 'You', clique, schoolClass, true, look);
    (card.querySelector('#ov-preview') as HTMLDivElement).innerHTML =
      `<b>${esc(m.name)}</b> &mdash; ${CLIQUES[clique].label} / ${CLASSES[schoolClass].label}<br>${attrLine(m)}<br>${statLine(m)}<br>${weaponLine(m)}<br>` +
      `<span style="opacity:.8">Starts knowing: ${esc(perkLineFor(m))}</span>`;
  };
  card.querySelector('#ov-looks')!.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).closest<HTMLButtonElement>('.choice')?.dataset.v as Look | undefined;
    if (v) {
      look = v;
      refresh();
    }
  });
  card.querySelector('#ov-cliques')!.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).closest<HTMLButtonElement>('.choice')?.dataset.v as Clique | undefined;
    if (v) {
      clique = v;
      refresh();
    }
  });
  card.querySelector('#ov-classes')!.addEventListener('click', (e) => {
    const v = (e.target as HTMLElement).closest<HTMLButtonElement>('.choice')?.dataset.v as SchoolClass | undefined;
    if (v) {
      schoolClass = v;
      refresh();
    }
  });
  nameEl.addEventListener('input', refresh);
  const go = (): void => onDone({ name: nameEl.value, clique, schoolClass, look });
  card.querySelector('#ov-start')!.addEventListener('click', go);
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  refresh();
  nameEl.focus();
}

/**
 * Pick who goes into the fight. The player character is always in; the rest are toggles, up to the
 * field size. `onGo` gets the chosen ids (leader first).
 */
export function showPrep(label: string, roster: RosterMember[], preferred: string[], onGo: (ids: string[]) => void, onCancel: () => void): void {
  const living = roster.filter((m) => !m.dead);
  const picked = new Set(chooseSquad(roster, preferred));
  const card = show(
    `<h1>${esc(label)}</h1><p class="sub">Choose who goes in. Up to ${FIELD_SIZE}; the leader always goes.</p>` +
      `<div class="grid" id="ov-squad">${living
        .map((m) => {
          const hurt = m.injuries.length ? `<span class="bad">${m.injuries.length} injur${m.injuries.length === 1 ? 'y' : 'ies'}</span>` : '';
          const max = effectiveStats(m).hp;
          return (
            `<button class="choice" data-id="${esc(m.id)}"${m.protagonist ? ' data-lead="1"' : ''}><b>${esc(m.name)}${m.protagonist ? ' (you)' : ''}</b>` +
            `<span>${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label} Lv ${m.level}</span>` +
            `<span class="${m.hp < max ? 'bad' : ''}">HP ${m.hp}/${max}</span>${hurt}</button>`
          );
        })
        .join('')}</div>` +
      `<div id="ov-count" class="preview"></div>` +
      `<div class="row"><button id="ov-go" class="primary">Go</button><button id="ov-back">Back to the map</button></div>`,
  );
  const refresh = (): void => {
    card.querySelectorAll<HTMLButtonElement>('#ov-squad .choice').forEach((b) => b.classList.toggle('selected', picked.has(b.dataset.id as string)));
    (card.querySelector('#ov-count') as HTMLDivElement).textContent = `${picked.size} of ${Math.min(FIELD_SIZE, living.length)} chosen`;
    (card.querySelector('#ov-go') as HTMLButtonElement).disabled = picked.size !== Math.min(FIELD_SIZE, living.length);
  };
  card.querySelector('#ov-squad')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.choice');
    if (!b || b.dataset.lead) return;
    const id = b.dataset.id as string;
    if (picked.has(id)) picked.delete(id);
    else if (picked.size < FIELD_SIZE) picked.add(id);
    refresh();
  });
  card.querySelector('#ov-go')!.addEventListener('click', () => onGo([...picked]));
  card.querySelector('#ov-back')!.addEventListener('click', onCancel);
  refresh();
}
