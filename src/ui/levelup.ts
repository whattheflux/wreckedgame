import {
  ATTRS,
  ATTR_IDS,
  ATTR_MAX,
  CLASSES,
  CLIQUES,
  COMBAT_SKILLS,
  COMBAT_SKILL_IDS,
  PERKS,
  PICK_LABEL,
  autoSpend,
  canRaise,
  canTrain,
  combatValue,
  effectiveStats,
  hasPending,
  modsText,
  spendAttribute,
  spendCombat,
  takePerk,
  xpToNext,
  type AttrId,
  type CombatSkillId,
  type RosterMember,
  type Roster,
} from '../engine';
import { EXTRA_SKILLS } from '../engine/skills';
import { esc, hideOverlay, showCard } from './screens';

/**
 * The level-up screen: spend whatever levelling handed out. One member at a time, with a tab per
 * member who still owes a choice; the screen closes itself when the last pick is spent.
 *
 * Nothing here decides anything. Every button calls one of the roster's `spend*` / `takePerk`
 * functions, which are the only things that can change a character.
 */

export interface LevelUpOptions {
  roster: Roster;
  /** called after every change, so the caller can save and refresh its panels */
  onChange?: () => void;
  onClose?: () => void;
}

const owing = (roster: Roster): RosterMember[] => roster.filter((m) => !m.dead && hasPending(m));

const statLine = (m: RosterMember): string => {
  const s = effectiveStats(m);
  return (
    `HP ${s.hp} &middot; Move ${s.mobility} &middot; Crit ${s.crit}% &middot; Sight ${s.sight}<br>` +
    `Ranged ${s.rangedAim} atk / ${s.rangedDefense} def &middot; Melee ${s.meleeAim} atk / ${s.meleeDefense} def`
  );
};

/** What a perk gives you, in one line. */
export function perkLine(id: string): string {
  const perk = PERKS[id];
  if (!perk) return id;
  const bits: string[] = [];
  if (perk.grants) bits.push(`Learns ${EXTRA_SKILLS[perk.grants]?.name ?? perk.grants}`);
  const mods = modsText(perk.mods);
  if (mods) bits.push(mods);
  return bits.join(' &middot; ');
}

export function showLevelUp(opts: LevelUpOptions): void {
  const { roster } = opts;
  let current = owing(roster)[0]?.id ?? '';

  const close = (): void => {
    hideOverlay();
    opts.onClose?.();
  };

  const render = (): void => {
    const list = owing(roster);
    if (list.length === 0) {
      close();
      return;
    }
    const m = list.find((x) => x.id === current) ?? list[0];
    current = m.id;

    const tabs =
      list.length > 1
        ? `<div class="tabs">${list
            .map((x) => `<button class="tab${x.id === m.id ? ' on' : ''}" data-who="${esc(x.id)}">${esc(x.name)} <b>${x.pending.length}</b></button>`)
            .join('')}</div>`
        : '';

    const kinds = [...new Set(m.pending.map((p) => p.kind))];
    const sections: string[] = [];

    if (kinds.includes('attribute')) {
      sections.push(
        `<h3>${PICK_LABEL.attribute} <small>one point, anywhere</small></h3>` +
          `<div class="grid attrs">${ATTR_IDS.map((id) => {
            const v = m.attributes[id];
            const full = !canRaise(m.attributes, id);
            return (
              `<button class="choice attr" data-attr="${id}"${full ? ' disabled' : ''} title="${esc(ATTRS[id].blurb)}">` +
              `<b><span class="letter">${ATTRS[id].letter}</span> ${ATTRS[id].label} <i>${v}${full ? ` (max ${ATTR_MAX})` : ` &rarr; ${v + 1}`}</i></b>` +
              `<span>${esc(ATTRS[id].effects.join(' &middot; ').replace(/&middot;/g, '·'))}</span></button>`
            );
          }).join('')}</div>`,
      );
    }

    if (kinds.includes('combat')) {
      sections.push(
        `<h3>${PICK_LABEL.combat} <small>one point of training</small></h3>` +
          `<div class="grid attrs">${COMBAT_SKILL_IDS.map((id: CombatSkillId) => {
            const def = COMBAT_SKILLS[id];
            const pts = m.combat[id];
            const full = !canTrain(m.combat, id);
            const now = combatValue(m.combat, id);
            return (
              `<button class="choice attr" data-combat="${id}"${full ? ' disabled' : ''} title="${esc(def.blurb)}">` +
              `<b>${def.label} <i>${pts}/${def.maxPoints}</i></b>` +
              `<span>${full ? 'Fully trained' : `+${def.per} ${def.unit}`} (now ${id === 'speed' ? `${now} speed` : now})</span></button>`
            );
          }).join('')}</div>`,
      );
    }

    for (const pick of m.pending.filter((p) => p.kind === 'classPerk' || p.kind === 'cliquePerk')) {
      const from = pick.kind === 'classPerk' ? CLASSES[m.schoolClass].label : CLIQUES[m.clique].label;
      sections.push(
        `<h3>${PICK_LABEL[pick.kind]} <small>${esc(from)}, level ${pick.level}</small></h3>` +
          `<div class="grid">${(pick.options ?? [])
            .map((id) => {
              const perk = PERKS[id];
              const known = m.perks.includes(id);
              return (
                `<button class="choice perk" data-perk="${esc(id)}"${known ? ' disabled' : ''}>` +
                `<b>${esc(perk?.name ?? id)}</b><span>${esc(perk?.blurb ?? '')}</span>` +
                `<span class="gain">${known ? 'Already learned' : perkLine(id)}</span></button>`
              );
            })
            .join('')}</div>`,
      );
    }

    const need = xpToNext(m.level);
    const card = showCard(
      `<h1>${esc(m.name)} &mdash; level ${m.level}</h1>` +
        `<p class="sub">${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label} &middot; ${Number.isFinite(need) ? `XP ${m.xp}/${need}` : 'at the cap'} &middot; ` +
        `<b>${m.pending.length}</b> choice${m.pending.length === 1 ? '' : 's'} left</p>` +
        tabs +
        sections.join('') +
        `<div class="preview">${statLine(m)}</div>` +
        `<div class="row"><button id="lv-auto">Decide for ${esc(m.name)}</button><button id="lv-all">Decide for everyone</button><button id="lv-later">Later</button></div>`,
    );

    const changed = (): void => {
      opts.onChange?.();
      render();
    };

    card.querySelector('.tabs')?.addEventListener('click', (e) => {
      const who = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab')?.dataset.who;
      if (who) {
        current = who;
        render();
      }
    });
    card.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.dataset.attr) {
        spendAttribute(m, b.dataset.attr as AttrId);
        changed();
      } else if (b.dataset.combat) {
        spendCombat(m, b.dataset.combat as CombatSkillId);
        changed();
      } else if (b.dataset.perk) {
        takePerk(m, b.dataset.perk);
        changed();
      }
    });
    card.querySelector('#lv-auto')?.addEventListener('click', () => {
      autoSpend(m);
      changed();
    });
    card.querySelector('#lv-all')?.addEventListener('click', () => {
      for (const x of owing(roster)) autoSpend(x);
      changed();
    });
    card.querySelector('#lv-later')?.addEventListener('click', close);
  };

  render();
}
