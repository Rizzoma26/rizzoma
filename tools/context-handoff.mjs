#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function git(args, allowFailure = false) {
  try {
    return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed (${error.status ?? 'unknown status'})`);
  }
}

const root = git(['rev-parse', '--show-toplevel']);
const outputRelative = 'docs/handoffs/branch-context.md';
const outputPath = path.join(root, outputRelative);
const requiredContext = [
  'AGENTS.md',
  '.agents/skills/backend-http/SKILL.md',
  '.agents/skills/docker/SKILL.md',
  '.agents/skills/postgres/SKILL.md',
  '.agents/skills/security-review/SKILL.md',
  '.agents/skills/system-design/SKILL.md',
  '.agents/skills/testing-debugging/SKILL.md',
  'README.md',
  'docs/index.md',
  'docs/handoff-guide.md',
  'docs/project-guide.md',
  'docs/data-and-idempotency.md',
  'docs/prompt-analysis.md',
  'docs/user-stories.md',
  'docs/review-baseline.md',
  'docs/environments.md'
];

function isSensitiveOrLocal(file) {
  const normalized = file.replaceAll('\\', '/');
  const segments = normalized.split('/');
  const name = segments.at(-1) ?? '';
  if (segments.some((part) => ['.idea', '.superpowers', '.codex'].includes(part))) return true;
  if (normalized.startsWith('docs/codex-')) return true;
  if (name === 'AGENTS.md.bak' || name.endsWith('.bak')) return true;
  if (/\.(pem|key)$/i.test(name)) return true;
  if (segments.some((part) => part === '.env' || (part.startsWith('.env.') && part !== '.env.example'))) return true;
  return false;
}

function readStatus() {
  const entries = git(['status', '--porcelain=v1', '--untracked-files=all', '-z']).split('\0');
  const changes = [];
  let excluded = 0;
  const excludedStatus = {staged: 0, unstaged: 0, untracked: 0};
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    let file = entry.slice(3);
    if (code.includes('R') || code.includes('C')) {
      const previous = entries[index + 1];
      if (previous) {
        file = `${file} <- ${previous}`;
        index += 1;
      }
    }
    if (file === outputRelative) continue;
    if (isSensitiveOrLocal(file)) {
      excluded += 1;
      if (code === '??') excludedStatus.untracked += 1;
      else {
        if (code[0] !== ' ') excludedStatus.staged += 1;
        if (code[1] !== ' ') excludedStatus.unstaged += 1;
      }
      continue;
    }
    changes.push({code, file});
  }
  return {changes, excluded, excludedStatus};
}

function isTracked(file) {
  return git(['ls-files', '--error-unmatch', '--', file], true) !== null;
}

function markdownPath(file) {
  return `\`${file.replaceAll('`', '\\`')}\``;
}

const branch = git(['branch', '--show-current']) || '(detached HEAD)';
const head = git(['rev-parse', '--short=12', 'HEAD']);
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true);
let tracking = 'upstream не настроен локально';
if (upstream) {
  const counts = git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).split(/\s+/);
  tracking = `ahead ${counts[0] ?? '0'}, behind ${counts[1] ?? '0'} относительно \`${upstream}\``;
}

const {changes, excluded, excludedStatus} = readStatus();
const staged = changes.filter(({code}) => code !== '??' && code[0] !== ' ');
const unstaged = changes.filter(({code}) => code !== '??' && code[1] !== ' ');
const untracked = changes.filter(({code}) => code === '??');
const missingContext = requiredContext.filter((file) => !fs.existsSync(path.join(root, file)));
const untrackedContext = requiredContext.filter((file) => fs.existsSync(path.join(root, file)) && !isTracked(file));
const contextWarnings = [];
if (missingContext.length) {
  contextWarnings.push(`### Не найдены обязательные документы\n\n${missingContext.map((file) => `- ${markdownPath(file)}`).join('\n')}`);
}
if (untrackedContext.length) {
  contextWarnings.push(`### Контекстные документы пока не отслеживаются Git\n\n${untrackedContext.map((file) => `- ${markdownPath(file)}`).join('\n')}`);
} else {
  contextWarnings.push('Все обязательные контекстные документы уже отслеживаются Git.');
}

function list(items) {
  if (!items.length) return '- нет';
  return items.map(({code, file}) => `- \`${code}\` ${markdownPath(file)}`).join('\n');
}

const content = `# Снимок передачи ветки

> Создан командой \`npm run handoff\`. Снимок фиксирует Git metadata и имена путей; исходный diff,
> значения env, credentials, содержимое БД и файлы локальных инструментов не читаются.

## Состояние Git на момент генерации

- Ветка: \`${branch}\`
- HEAD: \`${head}\`
- Upstream: ${tracking}
- Сгенерированный файл намеренно исключён из списка ниже, чтобы не ссылаться на собственную запись.

### Staged

${list(staged)}

### Изменены, но не staged

${list(unstaged)}

### Не отслеживаются Git

${list(untracked)}

${excluded ? `Локальные настройки, резервные копии или потенциально секретные пути пропущены: ${excluded} (staged ${excludedStatus.staged}, unstaged ${excludedStatus.unstaged}, untracked ${excludedStatus.untracked}). Их имена и содержимое не включены. Перед commit проверьте обычный \`git status\`.` : 'Локальные настройки и потенциально секретные пути пропущены по умолчанию.'}

${contextWarnings.join('\n\n')}

## Как продолжить

1. Начните с [правил репозитория](../../AGENTS.md), [индекса документации](../index.md) и [карты проекта](../project-guide.md).
2. Используйте [обзор базового приложения](../review-baseline.md) как запись выполненного review; проверьте его ограничения перед релизными выводами.
3. Прочитайте [handoff guide](../handoff-guide.md). Он указывает, какие файлы намеренно не входят в перенос.
4. Этот отчёт сам не добавляет файлы в Git. Сверьте status, выберите изменения, затем вручную stage/review/commit/push.
`;

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
if (previous !== content) fs.writeFileSync(outputPath, content, 'utf8');
process.stdout.write(`${previous === content ? 'Актуальный' : 'Обновлён'} handoff: ${outputRelative}\n`);
process.stdout.write(`Изменённые пути: staged ${staged.length}, unstaged ${unstaged.length}, untracked ${untracked.length}; контекстные документы вне Git ${untrackedContext.length}; исключено локальных/чувствительных путей ${excluded} (staged ${excludedStatus.staged}).\n`);
if (missingContext.length) process.exitCode = 1;
