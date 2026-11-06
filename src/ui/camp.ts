import { CLASSES, CLIQUES, INJURIES, effectiveStats, severityOf, type RosterMember } from '../engine';
import { AMBUSH_BY_DANGER, CAPTIVE_ACTION_LABEL, CAPTIVE_ACTION_TIP, bandages, ambushChance, canAct, captiveAction, dayOf, followers, isPrisoner, needsHelper, treatDays, treatMember, type CaptiveAction } from '../world/camp';
import { ensureStores, type Captive } from '../world/spoils';
import type { WorldState } from '../world/world';
import { esc, hideOverlayCard, showCard } from './screens';

/**
 * The camp screen. Everything a night in camp involves in one place: tend the wounded, deal with prisoners, change gear,
 * post a watch, and sleep. The rules live in world/camp.ts; this only shows them and calls them.
 */

export interface CampContext {
  world: WorldState;
  place: string;
  /** the home camp: no ambush, and everyone mends faster */
  safe: boolean;
  danger: number;
  onInventory: () => void;
  /** sleep until morning; an ambush ends the camp screen and starts a fight, otherwise it returns what happened */
  onSleep: (watch?: string) => { ambush: boolean; notes: string[] };
  onClose: () => void;
}

const PRISONER_ACTIONS: CaptiveAction[] = ['worker', 'fighter', 'ransom', 'beat', 'target', 'medical', 'execute'];

const injuryChip = (id: keyof typeof INJURIES, left: number): string => {
  const d = INJURIES[id];
  const sev = severityOf(id);
  const when = d.permanent ? 'permanent' : `${left} day${left === 1 ? '' : 's'}`;
  return `<span class="chip ${sev}" title="${esc(`${d.name} (${d.part}): ${d.blurb}`)}">${esc(d.name)} &middot; ${when}</span>`;
};

export function showCamp(ctx: CampContext): void {
  const w = ctx.world;
  let watch: string | undefined;
  let helper: string | undefined;
  let notes: string[] = [];
  const card = showCard('');

  const living = (): RosterMember[] => w.roster.filter((m) => !m.dead);

  const render = (): void => {
    const st = ensureStores(w);
    const squad = living();
    const helperId = squad.some((m) => m.id === helper) ? helper : squad[0]?.id;
    const risk = ctx.safe ? 0 : Math.round(ambushChance(ctx.danger, !!watch) * 100);
    const riskText = ctx.safe
      ? 'Safe here. Everyone sleeps properly and mends twice as fast.'
      : risk === 0
        ? 'Quiet ground: no risk of an ambush tonight.'
        : `Ambush risk tonight: <b>${risk}%</b>${watch ? ' (someone is keeping watch)' : ''}. ${AMBUSH_BY_DANGER[Math.min(4, ctx.danger)] ? 'A watch halves it, but they get little rest.' : ''}`;

    const members = squad
      .map((m) => {
        const max = effectiveStats(m).hp;
        const chips = m.injuries
          .map((i) => {
            const treatable = !INJURIES[i.id].permanent;
            const btn = treatable
              ? `<button class="mini" data-treat="${esc(m.id)}" data-inj="${i.id}" ${bandages(w) ? '' : 'disabled'} title="Use a bandage: takes ${treatDays(w)} days off">Treat</button>`
              : '';
            return `<span class="injrow">${injuryChip(i.id, i.left)}${btn}</span>`;
          })
          .join('');
        return (
          `<div class="crow"><div class="who"><b>${esc(m.name)}${m.protagonist ? ' (you)' : ''}</b> <small>${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label} Lv ${m.level}</small></div>` +
          `<div class="hp${m.hp < max ? ' hurt' : ''}">HP ${m.hp}/${max}</div>` +
          `<div class="inj">${chips || '<span class="ok">Fit</span>'}</div>` +
          `<label class="watch"><input type="radio" name="watch" data-watch="${esc(m.id)}" ${watch === m.id ? 'checked' : ''}> Watch</label></div>`
        );
      })
      .join('');

    const prisoners = st.captives.filter(isPrisoner);
    const helperSel = `<select data-helper>${squad.map((m) => `<option value="${esc(m.id)}"${m.id === helperId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`;
    const pris = prisoners.length
      ? `<p class="sub">Practice done by: ${helperSel}. One thing per prisoner per day.</p>` +
        prisoners
          .map((c: Captive) => {
            const chips = (c.injuries ?? []).map((i) => injuryChip(i.id, i.left)).join('') || '<span class="ok">Unhurt</span>';
            const btns = PRISONER_ACTIONS.map((a) => {
              const why = canAct(w, c, a);
              return `<button class="mini${a === 'execute' || a === 'target' || a === 'beat' ? ' grim' : ''}" data-cap="${esc(c.uid)}" data-act="${a}" ${why ? 'disabled' : ''} title="${esc(why ?? CAPTIVE_ACTION_TIP[a])}">${CAPTIVE_ACTION_LABEL[a]}</button>`;
            }).join('');
            return `<div class="prow"><div><b>${esc(c.name)}</b> <small>${esc(c.role)}</small> <span class="def" title="How hard they resist being turned">Defiance ${c.defiance ?? 60}</span><div class="inj">${chips}</div></div><div class="seg">${btns}</div></div>`;
          })
          .join('')
      : '<p class="sub">No prisoners.</p>';

    const turned = [...followers(w, 'worker').map((c) => `${c.name} (worker)`), ...followers(w, 'fighter').map((c) => `${c.name} (fighter)`)];
    card.innerHTML =
      `<h1>Camp &mdash; day ${dayOf(w)}</h1><p class="sub">${esc(ctx.place)}. ${riskText}</p>` +
      `<h3>Squad</h3><div class="camp">${members}</div>` +
      `<p class="sub">Bandages in the stash: <b>${bandages(w)}</b>. Wounds heal a day at a time (and a bandage takes ${treatDays(w)} off); scars never heal.</p>` +
      `<h3>Prisoners</h3>${pris}` +
      (turned.length ? `<p class="sub">Turned: ${esc(turned.join(', '))}. (Workers and fighters will have somewhere to go when the settlement is built.)</p>` : '') +
      `<p class="invmsg">${notes.map(esc).join('<br>')}</p>` +
      `<div class="row"><button id="camp-sleep" class="primary">Sleep until morning</button><button id="camp-inv">Inventory</button><button id="camp-close">Break camp</button></div>`;
  };

  card.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const wch = t.closest<HTMLInputElement>('[data-watch]');
    if (wch) {
      watch = wch.checked ? wch.dataset.watch : undefined;
      render();
    }
    const h = t.closest<HTMLSelectElement>('[data-helper]');
    if (h) helper = h.value;
  });
  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const treat = t.closest<HTMLElement>('[data-treat]');
    if (treat) {
      const r = treatMember(w, treat.dataset.treat as string, treat.dataset.inj as Parameters<typeof treatMember>[2]);
      notes = [r.msg];
      return render();
    }
    const cap = t.closest<HTMLElement>('[data-cap]');
    if (cap && !(cap as HTMLButtonElement).disabled) {
      const act = cap.dataset.act as CaptiveAction;
      const r = captiveAction(w, cap.dataset.cap as string, act, needsHelper(act) ? (helper ?? living()[0]?.id) : undefined);
      notes = [r.msg];
      return render();
    }
    if (t.closest('#camp-inv')) {
      hideOverlayCard();
      return ctx.onInventory();
    }
    if (t.closest('#camp-close')) {
      hideOverlayCard();
      return ctx.onClose();
    }
    if (t.closest('#camp-sleep')) {
      const r = ctx.onSleep(watch);
      if (r.ambush) return; // the fight has taken over the screen
      notes = r.notes;
      watch = undefined;
      render();
    }
  });
  render();
}
