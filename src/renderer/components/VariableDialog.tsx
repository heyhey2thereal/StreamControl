/**
 * Pop-up d'insertion de variables.
 *
 * Un bouton « {x} » est colle a droite de chaque champ texte d'un bloc. Il
 * ouvre cette liste : on cherche une variable, on clique, et elle s'insere a
 * l'endroit ou le curseur se trouvait dans le champ.
 *
 * Trois filtres aident a trouver la bonne variable :
 * - la **recherche** (jeton, libelle, description, exemple, alias) ;
 * - la **famille** (flux, OBS, poste, date...) ;
 * - le **flux designe** : les variables de flux existent en `{flux_nom}` (le
 *   flux courant) et en `{flux_nom_<identifiant>}` (un flux precis).
 *
 * Le catalogue vient de `macro-variables.ts` : c'est la meme source que celle
 * utilisee pour le remplacement a l'execution. L'interface ne reecrit donc
 * jamais une liste de variables a la main.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MacroVariable, VariableGroup } from '../../shared/macro-variables';
import {
  MACRO_VARIABLES,
  VARIABLE_GROUPS,
  variableDescriptionKey,
  variableLabelKey,
} from '../../shared/macro-variables';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from './Icon';

/** Une adresse proposee comme flux a designer. */
export interface DialogStream {
  id: string;
  name: string;
  path: string;
}

/** Une variable, avec son libelle traduit, pour la recherche. */
interface IndexedVariable {
  variable: MacroVariable;
  label: string;
  description: string;
}

/**
 * Pop-up de choix d'une variable.
 *
 * @param onPick appelé avec le jeton choisi (`flux_nom`), sans les accolades.
 * @param onClose appelé a la fermeture, quelle qu'en soit la cause.
 * @param streams adresses disponibles : elles alimentent le selecteur de flux.
 */
export function VariableDialog({
  onPick,
  onClose,
  streams = [],
}: {
  onPick: (token: string) => void;
  onClose: () => void;
  streams?: DialogStream[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<VariableGroup | 'all'>('all');
  const [streamId, setStreamId] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const indexed = useMemo<IndexedVariable[]>(
    () =>
      MACRO_VARIABLES.map((variable) => ({
        variable,
        label: t(variableLabelKey(variable) as never),
        description: t(variableDescriptionKey(variable) as never),
      })),
    [t],
  );

  // Recherche sur le jeton, le libelle, la description, l'exemple et les alias :
  // on doit pouvoir trouver « debit » sans connaitre le jeton `flux_debit`.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return indexed.filter((entry) => {
      if (group !== 'all' && entry.variable.group !== group) return false;
      if (!needle) return true;
      return (
        entry.variable.token.toLowerCase().includes(needle) ||
        entry.label.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle) ||
        entry.variable.sample.toLowerCase().includes(needle) ||
        (entry.variable.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle))
      );
    });
  }, [indexed, query, group]);

  // Le champ de recherche prend le focus a l'ouverture : on tape tout de suite.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // La selection reste dans les bornes quand le filtre change.
  useEffect(() => {
    setActive((current) => (current >= filtered.length ? 0 : current));
  }, [filtered.length]);

  /** Jeton reellement insere : le flux designe ajoute son identifiant. */
  const tokenFor = (variable: MacroVariable): string =>
    streamId && variable.perStream ? `${variable.token}_${streamId}` : variable.token;

  const commit = (index: number) => {
    const entry = filtered[index];
    if (!entry) return;
    onPick(tokenFor(entry.variable));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal variable-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('var.dialogTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            className="input"
            type="text"
            id="variable-search"
            placeholder={t('var.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                commit(active);
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
          />
          <button type="button" className="btn tiny ghost" onClick={onClose} title={t('action.close')}>
            ✕
          </button>
        </div>

        <div className="variable-groups">
          <button
            type="button"
            className={`chip${group === 'all' ? ' active' : ''}`}
            onClick={() => setGroup('all')}
          >
            {t('var.group.all')}
            <span className="muted"> {MACRO_VARIABLES.length}</span>
          </button>
          {VARIABLE_GROUPS.map((entry) => {
            const count = MACRO_VARIABLES.filter((variable) => variable.group === entry.id).length;
            if (count === 0) return null;
            return (
              <button
                key={entry.id}
                type="button"
                className={`chip${group === entry.id ? ' active' : ''}`}
                onClick={() => setGroup(entry.id)}
              >
                {t(entry.label as never)}
                <span className="muted"> {count}</span>
              </button>
            );
          })}
        </div>

        {/* Selecteur de flux : les variables de flux existent aussi pour une
            adresse precise, `{flux_nom_<identifiant>}`. */}
        {streams.length > 0 ? (
          <div className="variable-scope">
            <label htmlFor="variable-stream">{t('var.whichStream')}</label>
            <select
              className="input"
              id="variable-stream"
              value={streamId}
              onChange={(event) => setStreamId(event.target.value)}
            >
              <option value="">{t('var.currentStream')}</option>
              {streams.map((stream) => (
                <option key={stream.id} value={stream.id}>
                  {stream.name} (/{stream.path})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="variable-list" id="variable-list">
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>
              {t('var.none')}
            </div>
          ) : (
            filtered.map((entry, index) => (
              <button
                key={entry.variable.token}
                type="button"
                className={`variable-row${index === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onPick(tokenFor(entry.variable));
                  onClose();
                }}
              >
                <span className="variable-token">{`{${tokenFor(entry.variable)}}`}</span>
                <span className="variable-text">
                  <span className="variable-label">{entry.label}</span>
                  <span className="variable-desc">{entry.description}</span>
                </span>
                <span className="variable-sample" title={entry.variable.sample}>
                  {entry.variable.sample}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="modal-foot muted">{t('var.hint', { count: filtered.length })}</div>
      </div>
    </div>
  );
}
