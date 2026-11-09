/**
 * Validation des actions de macro.
 *
 * Le principe : **le catalogue de blocs est la seule reference**. Un champ
 * declare dans `macro-blocks.ts` est conserve, sans liste a maintenir ici.
 * C'est ce qui evite le bug classique du champ oublie : ajouter un bloc
 * n'exigeait auparavant de penser a cette validation, et un oubli faisait
 * disparaitre silencieusement la valeur saisie par l'utilisateur.
 *
 * Les valeurs sont converties selon leur nature : un nombre reste un nombre,
 * un booleen reste un booleen, meme quand il vaut `false` ou `0`.
 */
import type { MacroAction } from './types';
import { blockFor } from './macro-blocks';

/** Convertit une valeur brute selon la nature attendue du champ. */
function coerce(kind: string, raw: unknown): unknown {
  switch (kind) {
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'toggle':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'scene':
    case 'source':
    case 'stream':
    case 'text':
    case 'path':
    case 'file':
    case 'folder':
    case 'url':
    case 'password':
    case 'condition':
    case 'operator':
    case 'choice':
    case 'level':
      // Une chaine vide est une valeur legitime : « aucun filtre », « aucune
      // source ». On la conserve donc, au lieu de la traiter comme absente.
      return typeof raw === 'string' ? raw : raw === undefined ? undefined : String(raw);
    default:
      return raw;
  }
}

/**
 * Valide une suite d'actions, recursivement.
 *
 * Les blocs « repeter » et « condition » contiennent une sous-sequence : la
 * validation descend dans l'arbre, sinon les blocs imbriques seraient perdus.
 */
export function sanitizeMacroActions(actions: unknown): MacroAction[] {
  if (!Array.isArray(actions)) return [];
  const result: MacroAction[] = [];

  for (const entry of actions) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.kind !== 'string') continue;

    const definition = blockFor(raw.kind as MacroAction['kind']);
    const clean: MacroAction = { kind: raw.kind as MacroAction['kind'] };

    // On parcourt les champs declares par le bloc : c'est la liste fiable.
    for (const field of definition?.fields ?? []) {
      const value = coerce(field.kind, raw[field.key as string]);
      if (value !== undefined) {
        (clean as unknown as Record<string, unknown>)[field.key as string] = value;
      }
    }

    // `delaySeconds` n'est pas un champ de bloc : il est commun a tous.
    const delay = coerce('number', raw.delaySeconds);
    if (delay !== undefined) clean.delaySeconds = delay as number;

    // Sous-sequence des blocs imbriques.
    if (definition?.nested) {
      clean.actions = sanitizeMacroActions(raw.actions);
    }

    // Un bloc inconnu (catalogue plus ancien que les reglages, ou l'inverse)
    // est conserve tel quel : mieux vaut une action inerte qu'une perte.
    if (!definition) {
      Object.assign(clean, raw);
    }

    result.push(clean);
  }

  return result;
}
