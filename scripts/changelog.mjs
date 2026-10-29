#!/usr/bin/env node
/**
 * Genere le journal des modifications d'une version, a partir de l'historique
 * Git et des messages de commit.
 *
 * Objectif : une vraie note de version lisible, et non un simple lien de
 * comparaison. Les commits sont classes par nature, et leur corps est conserve
 * lorsqu'il apporte une explication utile.
 *
 * Usage : node scripts/changelog.mjs [reference] > NOTES.md
 *   reference : tag ou plage a documenter (par defaut : le dernier tag)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/** Retourne le tag de version courant, ou null si aucun. */
function currentTag() {
  const exact = gitOrNull(['describe', '--tags', '--exact-match']);
  if (exact) return exact;
  const all = gitOrNull(['tag', '--list', 'v*', '--sort=-v:refname']);
  return all ? all.split('\n')[0] : null;
}

/** Retourne le tag precedent celui fourni. */
function previousTag(tag) {
  const all = gitOrNull(['tag', '--list', 'v*', '--sort=-v:refname']);
  if (!all) return null;
  const tags = all.split('\n').filter(Boolean);
  const index = tags.indexOf(tag);
  if (index === -1) return tags[0] ?? null;
  return tags[index + 1] ?? null;
}

/**
 * Classe un commit par nature, d'apres son intitule.
 * L'ordre de ces regles definit l'ordre des sections dans la note.
 */
const SECTIONS = [
  // L'ordre de ce tableau est l'ordre des sections dans la note : on place en
  // tete ce qui interesse le plus celui qui lit la version.
  { title: 'Corrections', test: /^(corrige|correction|fix|repare|reduit)/i },
  // Interface avant Nouveautes : un intitule comme "Nouveau logo" releve de
  // l'interface, pas d'une fonctionnalite.
  { title: 'Interface', test: /(logo|refonte|interface|visuel|style|design)/i },
  { title: 'Nouveautes', test: /^(ajoute|ajout|nouveau|nouvelle|add|implemente)/i },
  { title: 'Documentation', test: /^(documente|documentation|readme|doc)/i },
  { title: 'Maintenance', test: /^(compacte|nettoie|renomme|deplace|met a jour|bump|montee)/i },
  { title: 'Integration continue', test: /^(joint|ci|workflow|workflows|release|installeur)/i },
];

function classify(subject) {
  for (const section of SECTIONS) {
    if (section.test.test(subject)) return section.title;
  }
  return 'Autres modifications';
}

/** Formate un commit : premiere ligne en puce, corps en bloc replie. */
function formatCommit(hash, subject, body) {
  const short = hash.slice(0, 7);
  const line = `- ${subject} (\`${short}\`)`;

  const details = body
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/^(co-authored-by|signed-off-by)/i.test(entry));

  if (details.length === 0) return line;

  // Le corps est conserve : il explique le pourquoi, ce qu'un intitule seul
  // ne peut pas porter.
  return `${line}\n\n${details.map((entry) => `  ${entry}`).join('\n')}\n`;
}

function main() {
  const tag = process.argv[2] ?? currentTag();
  const previous = tag ? previousTag(tag) : null;

  // Le tag demande peut ne pas exister encore (premier build d'une version) :
  // on retombe alors sur HEAD, et le journal couvre toute la version.
  const tagExists = tag ? gitOrNull(['rev-parse', '--verify', `refs/tags/${tag}`]) !== null : false;
  const range = previous && tagExists ? `${previous}..${tag}` : tagExists ? `${tag}` : 'HEAD';

  // Chaque commit est separe par un caractere de controle, et ses champs par un
  // autre : les corps de commit contiennent des sauts de ligne, un decoupage
  // ligne par ligne les tronquerait.
  const RECORD = '\u001e';
  const FIELD = '\u001f';
  const raw = gitOrNull(['log', `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, range]) ?? '';

  const entries = raw
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [hash, subject, ...rest] = record.split(FIELD);
      return { hash: (hash ?? '').trim(), subject: (subject ?? '').trim(), body: rest.join(FIELD) };
    })
    .filter((entry) => entry.hash && entry.subject && !/^(fusionne|merge)/i.test(entry.subject));

  const grouped = new Map();
  for (const entry of entries) {
    const section = classify(entry.subject);
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section).push(entry);
  }

  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# StreamControl ${tag ?? ''}`.trim(),
    '',
    previous
      ? `Modifications apportees depuis ${previous}.`
      : 'Premiere version publiee : cette note liste tout le travail qu\'elle contient.',
    '',
  ];

  // Les sections suivent l'ordre declare, pas l'ordre d'apparition.
  // Ordre d'affichage : les corrections d'abord, puis les nouveautes, puis le
  // reste. Il differe de l'ordre de test ci-dessus, ou Interface passe avant
  // Nouveautes pour la classification.
  const DISPLAY_ORDER = [
    'Corrections',
    'Nouveautes',
    'Interface',
    'Documentation',
    'Maintenance',
    'Integration continue',
    'Autres modifications',
  ];
  const order = DISPLAY_ORDER;
  for (const title of order) {
    const items = grouped.get(title);
    if (!items || items.length === 0) continue;
    lines.push(`## ${title}`, '');
    for (const item of items) lines.push(formatCommit(item.hash, item.subject, item.body));
    lines.push('');
  }

  lines.push('---', '', '## Installation', '');
  lines.push('1. Telechargez `StreamControl-Setup-' + (tag ?? '').replace(/^v/, '') + '.exe` ci-dessous.');
  lines.push("2. Lancez l'installeur (aucun droit administrateur n'est exige).");
  lines.push('3. Au premier demarrage, autorisez l\'acces reseau pour les reseaux prives,');
  lines.push('   sinon la camera ne pourra pas publier.');
  lines.push('');
  lines.push('### A propos de SmartScreen et des antivirus');
  lines.push('');
  lines.push("L'installeur n'est pas signe numeriquement : il n'existe pas de certificat de");
  lines.push('signature de code pour ce projet. Windows affiche donc un avertissement');
  lines.push('SmartScreen au premier lancement, et certains antivirus peuvent signaler le');
  lines.push("fichier parce qu'il est peu repandu (reputation faible), pas parce qu'il");
  lines.push('contient quelque chose de dangereux.');
  lines.push('');
  lines.push('Ce qui est fait pour limiter ces avertissements :');
  lines.push('');
  lines.push('- metadonnees completes du binaire (editeur, produit, version, copyright) ;');
  lines.push('- installation par utilisateur, sans elevation de privileges ;');
  lines.push('- archive NSIS standard, produite par electron-builder, sans script personnalise ;');
  lines.push('- empreintes SHA-256 de chaque fichier produit, listees dans `build-log.txt`.');
  lines.push('');
  lines.push("Ce qui les supprimerait vraiment : signer l'installeur avec un certificat");
  lines.push("d'editeur. C'est la seule reponse complete ; tout le reste ne fait que");
  lines.push('reduire la frequence des avertissements.');
  lines.push('');
  lines.push('Pour passer SmartScreen une fois : *Informations complementaires*, puis');
  lines.push('*Executer quand meme*.');
  lines.push('');
  lines.push('### Journal de compilation');
  lines.push('');
  lines.push("`build-log.txt` est joint a cette version, quelle que soit l'ampleur du");
  lines.push('changement. Il contient les versions des outils, la liste des commits et des');
  lines.push('fichiers modifies de la version, la sortie integrale de chaque etape, et les');
  lines.push('empreintes SHA-256 des fichiers produits.');
  lines.push('');
  lines.push(`*Version construite le ${date}.*`);
  lines.push('');

  const output = lines.join('\n');
  process.stdout.write(output);
  writeFileSync(path.join(projectRoot, 'release-notes.md'), output);
}

main();
