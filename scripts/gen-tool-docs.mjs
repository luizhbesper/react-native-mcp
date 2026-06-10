#!/usr/bin/env node
// spec: 040 — generates docs/src/content/docs/reference/tools.md from the zod schemas.
// Run via `pnpm gen:docs`. CI fails if the committed file drifts from the schemas.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { buildToolCatalog } from '../dist/catalog.mjs';

const fullCaps = {
  host: { os: 'darwin', arch: 'arm64', node: '22.0.0' },
  ios: { available: true, simctl: true },
  android: { available: true, adbPath: '/usr/bin/adb' },
  project: { found: true },
  problems: [],
};

const PILLARS = [
  { prefix: '00', label: 'Environment' },
  { prefix: '01', label: 'Device control' },
  { prefix: '02', label: 'Runtime bridge' },
  { prefix: '03', label: 'Build diagnostics' },
];

// everything is wrapped in code spans so MDX never parses `<object>` as JSX
function typeOf(prop) {
  if (!prop || typeof prop !== 'object') return '`any`';
  if (prop.enum) return prop.enum.map((v) => `\`${v}\``).join(' \\| ');
  if (prop.const !== undefined) return `\`${prop.const}\``;
  if (prop.type === 'array') return `\`array<${typeOf(prop.items).replaceAll('`', '')}>\``;
  return `\`${prop.type ?? 'any'}\``;
}

// MDX parses raw `<…>` as JSX — escape it everywhere prose can carry it
const mdxSafe = (text) => text.replaceAll('<', '\\<');

function schemaTable(shape, header) {
  if (!shape || Object.keys(shape).length === 0) return `**${header}:** none\n`;
  const jsonSchema = z.toJSONSchema(z.object(shape), { io: 'input', unrepresentable: 'any' });
  const required = new Set(jsonSchema.required ?? []);
  const rows = Object.entries(jsonSchema.properties ?? {}).map(([name, prop]) => {
    const req = required.has(name) ? 'yes' : 'no';
    const description = mdxSafe(prop.description ?? '').replaceAll('|', '\\|');
    return `| \`${name}\` | ${typeOf(prop)} | ${req} | ${description} |`;
  });
  return [`**${header}:**`, '', '| Field | Type | Required | Description |', '| --- | --- | --- | --- |', ...rows, ''].join('\n');
}

function annotationBadges(tool) {
  const badges = [];
  if (tool.annotations?.readOnlyHint) badges.push('read-only');
  if (tool.annotations?.destructiveHint) badges.push('**destructive**');
  if (tool.annotations?.idempotentHint) badges.push('idempotent');
  return badges.length ? `*${badges.join(' · ')}*\n` : '';
}

const catalog = buildToolCatalog(fullCaps);
const sections = PILLARS.map(({ prefix, label }) => {
  const tools = catalog.filter((t) => t.spec.startsWith(prefix));
  const body = tools
    .map((tool) =>
      [
        `### \`${tool.name}\``,
        '',
        mdxSafe(tool.description),
        '',
        annotationBadges(tool),
        schemaTable(tool.inputSchema, 'Input'),
        schemaTable(tool.outputSchema, 'Output (`structuredContent`)'),
        `<sup>Contract: [spec ${tool.spec}](https://github.com/luizhbesper/react-native-mcp/tree/main/specs)</sup>`,
        '',
      ].join('\n'),
    )
    .join('\n');
  return `## ${label}\n\n${body}`;
});

const page = `---
title: Tools
description: Complete reference for all ${catalog.length} tools, generated from the source schemas.
---

{/* GENERATED FILE — do not edit. Run \`pnpm gen:docs\` after changing tool schemas. */}

All tools return a short text summary plus \`structuredContent\` matching the output schema.
Failures come back as structured errors — see [error codes](/react-native-mcp/reference/error-codes/).
Tool availability depends on your host (e.g. iOS tools require macOS); run \`doctor\` to see
what's registered.

${sections.join('\n')}
`;

const outPath = fileURLToPath(
  new URL('../docs/src/content/docs/reference/tools.mdx', import.meta.url),
);
writeFileSync(outPath, page);
console.error(`wrote ${outPath} (${catalog.length} tools)`);
