import { ITEMS, effectiveStats, livingSquad, xpToNext, type RosterMember } from '../engine';
import {
  FACILITY,
  HOUSES,
  MAX_ACTIVE,
  TRAINING,
  TRAIN_PER_DAY,
  abandonMission,
  acceptMission,
  buyHouse,
  buyItem,
  costOf,
  deliver,
  discountOf,
  facilityOpen,
  houseCost,
  houseOf,
  peopleAt,
  refreshSettlement,
  reportMission,
  sellValue,
  sellable,
  sellItem,
  settlementDef,
  standingToNext,
  tierDef,
  tierOf,
  trainMember,
  trainingLeft,
  type Facility,
  type SettlementState,
} from '../world/settlement';
import { isComplete, isHandIn, missionStatus, progress, type Mission } from '../world/missions';
import { ensureStores } from '../world/spoils';
import type { WorldState } from '../world/world';
import { esc, hideOverlayCard, showCard } from './screens';

/**
 * The settlement screen: the mission board, the store, the training guild, the people and the
 * houses, behind one set of tabs. Every button calls into world/settlement.ts, which owns the rules;
 * this file only shows what is there and reports what came back.
 */

export interface SettlementContext {
  world: WorldState;
  /** the settlement's site id */
  id: string;
  /** called after anything that changes the world, so the caller can save and refresh its panels */
  onChange: (notes?: string[]) => void;
  onInventory: () => void;
  onClose: () => void;
}

type Tab = Facility;

const TAB_ORDER: Tab[] = ['board', 'store', 'training', 'people', 'houses'];

const bar = (frac: number): string =>
  `<span class="pbar"><span style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></span></span>`;

const rewardLine = (m: Mission): string =>
  [m.scrap ? `+${m.scrap} scrap` : '', `+${m.standing} standing`, m.xp ? `+${m.xp} XP each` : '', m.item ? `+${ITEMS[m.item]?.name ?? m.item}` : '']
    .filter(Boolean)
    .join(' &middot; ');

export function showSettlement(ctx: SettlementContext): void {
  const w = ctx.world;
  let tab: Tab = 'board';
  let trainee: string | undefined;
  let msg = '';
  const card = showCard('');

  const say = (text: string, notes?: string[]): void => {
    msg = text;
    ctx.onChange(notes);
    render();
  };

  const render = (): void => {
    const st = w.settlements?.[ctx.id];
    if (!st) {
      hideOverlayCard();
      ctx.onClose();
      return;
    }
    refreshSettlement(w, st);
    const def = settlementDef(st.id);
    const tier = tierOf(st);
    const d = tierDef(tier);
    const need = standingToNext(st);
    const house = houseOf(st);
    const squad = livingSquad(w.roster);
    if (!squad.some((m) => m.id === trainee)) trainee = squad[0]?.id;

    const tabs = TAB_ORDER.map((t) => {
      const open = facilityOpen(st, t);
      const count = t === 'board' ? st.active.filter(isComplete).length : 0;
      return (
        `<button class="tab${t === tab ? ' on' : ''}" data-tab="${t}"${open ? '' : ' disabled'} ` +
        `title="${esc(open ? FACILITY[t].blurb : `Opens at ${tierDef(FACILITY[t].tier).name}`)}">` +
        `${esc(FACILITY[t].label)}${count ? ` <b style="color:#8fd39a">${count}</b>` : ''}${open ? '' : ' 🔒'}</button>`
      );
    }).join('');

    const header =
      `<h1>${esc(def?.name ?? st.id)}</h1>` +
      `<p class="sub">${esc(d.name)} &middot; standing <b>${st.standing}</b>` +
      (need === null ? ' &middot; as big as it gets' : ` &middot; ${need} more for ${esc(tierDef(tier + 1).name)}`) +
      ` &middot; you have <b>${w.scrap}</b> scrap` +
      (house ? ` &middot; resident: ${esc(house.name)}` : '') +
      `</p>` +
      `<div class="preview">${esc(st.standing === 0 ? (def?.intro ?? '') : d.blurb)}${need === null ? '' : `<br>${bar(1 - need / Math.max(1, tierDef(tier + 1).standing - d.standing))}`}</div>`;

    render_body(st, squad, header, tabs);
  };

  const render_body = (st: SettlementState, squad: RosterMember[], header: string, tabs: string): void => {
    let body = '';

    if (tab === 'board') {
      const active = st.active;
      const mine = active.length
        ? active
            .map((m) => {
              const done = isComplete(m);
              const buttons = done
                ? `<button class="mini" data-report="${esc(m.id)}">Report in</button>`
                : (isHandIn(m.kind) ? `<button class="mini" data-deliver="${esc(m.id)}">Hand over</button>` : '') +
                  `<button class="mini" data-abandon="${esc(m.id)}">Give back</button>`;
              return (
                `<div class="mrow${done ? ' ready' : ''}"><div><b>${esc(m.title)}</b>${m.story ? ' <span class="chip story">story</span>' : ''}` +
                `<br><span class="dim">${esc(missionStatus(m))}</span> ${bar(progress(m))}` +
                `<br><span class="gain">${rewardLine(m)}</span></div><div class="mbtns">${buttons}</div></div>`
              );
            })
            .join('')
        : '<p class="dim">Nothing taken on.</p>';

      const offers = st.board.length
        ? st.board
            .map(
              (m) =>
                `<div class="mrow"><div><b>${esc(m.title)}</b>${m.story ? ' <span class="chip story">story</span>' : ''}` +
                `<br><span class="dim">${esc(m.blurb)}</span>` +
                `<br><span class="gain">${rewardLine(m)}</span></div>` +
                `<div class="mbtns"><button class="mini" data-take="${esc(m.id)}"${active.length >= MAX_ACTIVE ? ' disabled' : ''}>Take</button></div></div>`,
            )
            .join('')
        : '<p class="dim">The board is bare today. Come back tomorrow.</p>';

      body =
        `<h3>Carrying <small>${active.length}/${MAX_ACTIVE}</small></h3>${mine}` +
        `<h3>On the board <small>refreshed each day</small></h3>${offers}`;
    }

    if (tab === 'store') {
      const disc = discountOf(st);
      const shelf = st.stock.length
        ? st.stock
            .map((id, i) => {
              const cost = costOf(st, id);
              const def = ITEMS[id];
              return (
                `<button class="choice" data-buy="${i}"${w.scrap < cost ? ' disabled' : ''} title="${esc(def?.desc ?? '')}">` +
                `<b>${esc(def?.name ?? id)} <i>${cost}</i></b><span>${esc(def?.desc ?? '')}</span></button>`
              );
            })
            .join('')
        : '<p class="dim">Shelves empty.</p>';

      const stash = ensureStores(w).stash;
      const mine = stash.length
        ? stash
            .map((id, i) =>
              sellable(id)
                ? `<button class="choice" data-sell="${i}" title="They will give you ${sellValue(id)} scrap"><b>${esc(ITEMS[id]?.name ?? id)} <i>${sellValue(id)}</i></b><span>Sell</span></button>`
                : `<button class="choice" disabled><b>${esc(ITEMS[id]?.name ?? id)}</b><span>They will not touch it</span></button>`,
            )
            .join('')
        : '<p class="dim">Your stash is empty.</p>';

      body =
        `<h3>For sale <small>${disc ? `${Math.round(disc * 100)}% resident's discount` : 'restocked each day'}</small></h3><div class="grid">${shelf}</div>` +
        `<h3>Your stash <small>sells for ${Math.round(100 * 0.4)}% of list</small></h3><div class="grid">${mine}</div>`;
    }

    if (tab === 'training') {
      const left = trainingLeft(w, st);
      const who = squad
        .map((m) => {
          const need = xpToNext(m.level);
          return (
            `<button class="choice${m.id === trainee ? ' selected' : ''}" data-who="${esc(m.id)}">` +
            `<b>${esc(m.name)} <i>Lv ${m.level}</i></b>` +
            `<span>${Number.isFinite(need) ? `XP ${m.xp}/${need}` : 'at the cap'}${m.pending.length ? ` &middot; ${m.pending.length} to spend` : ''}</span></button>`
          );
        })
        .join('');
      const sessions = TRAINING.map((t) => {
        const locked = tierOf(st) < t.tier;
        const broke = w.scrap < t.cost;
        return (
          `<button class="choice" data-train="${t.id}"${locked || broke || left <= 0 ? ' disabled' : ''} title="${esc(t.blurb)}">` +
          `<b>${esc(t.name)} <i>${t.cost}</i></b>` +
          `<span>${locked ? `Needs a ${tierDef(t.tier).name.toLowerCase()}` : `+${t.xp} XP`}</span></button>`
        );
      }).join('');
      body =
        `<h3>Who is training <small>sessions left today: ${left}/${TRAIN_PER_DAY}</small></h3><div class="grid">${who}</div>` +
        `<h3>What they will put them through</h3><div class="grid">${sessions}</div>` +
        `<p class="dim">Training buys experience, not points. What a level-up gives you is still yours to spend.</p>`;
    }

    if (tab === 'people') {
      const folk = peopleAt(st);
      const hidden = (settlementDef(st.id)?.npcs.length ?? 0) - folk.length;
      body =
        `<h3>The people here</h3>` +
        folk
          .map(
            (n) =>
              `<div class="mrow"><div><b>${esc(n.name)}</b> <span class="dim">${esc(n.role)}</span>` +
              `<br><span class="dim">${esc(n.blurb)}</span>` +
              (st.board.some((m) => m.from === n.id) ? '<br><span class="gain">Has something to ask you &mdash; see the board.</span>' : '') +
              `</div></div>`,
          )
          .join('') +
        (hidden > 0 ? `<p class="dim">${hidden} more here will not deal with you yet. Keep working.</p>` : '');
    }

    if (tab === 'houses') {
      const owned = houseOf(st);
      body =
        `<h3>Somewhere to live</h3><div class="grid">${HOUSES.map((h) => {
          const cost = houseCost(st, h);
          const isMine = owned?.id === h.id;
          const worse = owned && HOUSES.indexOf(owned) > HOUSES.indexOf(h);
          const locked = tierOf(st) < h.tier;
          return (
            `<button class="choice${isMine ? ' selected' : ''}" data-house="${h.id}"${isMine || worse || locked || w.scrap < cost ? ' disabled' : ''} title="${esc(h.blurb)}">` +
            `<b>${esc(h.name)} <i>${isMine ? 'yours' : cost}</i></b>` +
            `<span>${locked ? `Needs a ${tierDef(h.tier).name.toLowerCase()}` : esc(h.blurb)}</span>` +
            `<span class="gain">${[h.heal ? `injuries mend ${h.heal} day${h.heal === 1 ? '' : 's'} faster when you sleep here` : '', h.discount ? `${Math.round(h.discount * 100)}% off the store` : ''].filter(Boolean).join(' &middot; ')}</span></button>`
          );
        }).join('')}</div>` +
        (owned ? `<p class="dim">You live at ${esc(owned.name)}. Moving up trades half of what you paid against the new place.</p>` : '');
    }

    card.innerHTML =
      header +
      `<div class="tabs">${tabs}</div>` +
      `<div class="sbody">${body}</div>` +
      (msg ? `<div class="preview">${esc(msg)}</div>` : '') +
      `<div class="row"><button id="st-inv">Inventory (I)</button><button id="st-done">Leave</button></div>`;
  };

  // One delegated handler for the whole card. The card outlives every re-render, so attaching this
  // inside `render` would stack a listener per render and fire a click several times over.
  const wire = (root: HTMLElement): void => {
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.id === 'st-done') {
        hideOverlayCard();
        ctx.onClose();
        return;
      }
      if (b.id === 'st-inv') {
        ctx.onInventory();
        return;
      }
      const st = w.settlements?.[ctx.id];
      if (!st) return;
      const dd = b.dataset;
      if (dd.tab) {
        tab = dd.tab as Tab;
        msg = '';
        render();
      } else if (dd.take) {
        say(acceptMission(st, dd.take).msg);
      } else if (dd.abandon) {
        say(abandonMission(st, dd.abandon).msg);
      } else if (dd.deliver) {
        say(deliver(w, st, dd.deliver).msg);
      } else if (dd.report) {
        const r = reportMission(w, st, dd.report);
        say(r.msg, r.notes);
      } else if (dd.buy) {
        say(buyItem(w, st, Number(dd.buy)).msg);
      } else if (dd.sell) {
        say(sellItem(w, st, Number(dd.sell)).msg);
      } else if (dd.who) {
        trainee = dd.who;
        render();
      } else if (dd.train) {
        const r = trainMember(w, st, trainee ?? '', dd.train);
        say(r.msg, r.notes);
      } else if (dd.house) {
        say(buyHouse(w, st, dd.house).msg);
      }
    });
  };

  wire(card);
  render();
}

/** Re-open the screen after a detour (the inventory, say). */
export const reopenSettlement = showSettlement;

/** One line for the world panel: what the settlement is and what is owed. */
export function settlementSummary(st: SettlementState): string {
  const ready = st.active.filter(isComplete).length;
  const parts = [`${tierDef(tierOf(st)).name} &middot; standing ${st.standing}`];
  if (st.active.length) parts.push(`${st.active.length} job${st.active.length === 1 ? '' : 's'} on${ready ? `, ${ready} ready` : ''}`);
  const h = houseOf(st);
  if (h) parts.push(h.name);
  return parts.join(' &middot; ');
}

/** The member the training tab lands on by default. */
export const defaultTrainee = (w: WorldState): RosterMember | undefined =>
  [...livingSquad(w.roster)].sort((a, b) => a.level - b.level || effectiveStats(a).hp - effectiveStats(b).hp)[0];
