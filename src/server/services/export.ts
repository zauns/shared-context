import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';
import type { Database } from '../db/connection.js';
import { listIssueRows } from '../db/repositories/issues.js';
import { listProjectRows, findProjectRow } from '../db/repositories/projects.js';
import { listActors } from '../domain/actors.js';
import { listProjectActivity } from '../domain/activity.js';
import { DomainError } from '../domain/errors.js';
import { issueRowToDetail } from '../domain/issues.js';
import { projectRowToSummary } from '../domain/project-summary.js';
import { STAGES, type IssueDetail, type ProjectSummary, type Stage } from '../domain/types.js';
import { slugify } from '../domain/validation.js';

export interface ExportEntry {
  name: string;
  content: string;
}

export interface MarkdownExport {
  filename: string;
  entries: ExportEntry[];
}

function stageLabel(stage: Stage): string {
  return stage === 'in_progress'
    ? 'In Progress'
    : stage.charAt(0).toUpperCase() + stage.slice(1);
}

function exportStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function issueFileName(issue: IssueDetail): string {
  let slug = 'issue';
  try {
    slug = slugify(issue.title).slice(0, 60) || 'issue';
  } catch {
    // Non-Latin titles still get a stable key-based filename.
  }
  return `${issue.key}-${slug}.md`;
}

function yamlValue(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

function frontmatter(issue: IssueDetail): string {
  return [
    '---',
    `project: ${yamlValue(issue.project.key)}`,
    `key: ${yamlValue(issue.key)}`,
    `stage: ${issue.stage}`,
    `priority: ${issue.priority}`,
    `assignee: ${yamlValue(issue.assignee?.name ?? null)}`,
    `module: ${yamlValue(issue.module?.name ?? null)}`,
    `parent: ${yamlValue(issue.parent?.key ?? null)}`,
    `blocked: ${issue.blocked}`,
    `created: ${issue.created_at}`,
    `updated: ${issue.updated_at}`,
    '---',
  ].join('\n');
}

function issueMarkdown(issue: IssueDetail, filenames: Map<string, string>): string {
  const lines: string[] = [
    frontmatter(issue),
    '',
    `# ${issue.key} — ${issue.title}`,
    '',
    issue.description || '_No description._',
    '',
  ];

  if (issue.children.length > 0) {
    lines.push('## Children', '');
    for (const child of issue.children) {
      const target = filenames.get(child.id) ?? '#';
      lines.push(
        `- [${child.key} — ${child.title}](${target}) — ${stageLabel(child.stage)}`,
      );
    }
    lines.push('');
  }

  if (issue.links.length > 0) {
    lines.push('## Links', '');
    for (const link of issue.links) {
      lines.push(`- [${link.label ?? link.url}](${link.url})`);
    }
    lines.push('');
  }

  if (issue.attachments.length > 0) {
    lines.push('## Attachments', '');
    for (const attachment of issue.attachments) {
      const textState = attachment.has_text ? 'text available' : 'no extractable text';
      lines.push(
        `- ${attachment.original_name} — ${attachment.size_bytes} bytes — ${attachment.mime_type} (${textState})`,
      );
    }
    lines.push('');
  }

  if (issue.comments.length > 0) {
    lines.push('## Comments', '');
    for (const comment of issue.comments) {
      lines.push(`### ${comment.author.name} — ${comment.created_at}`, '', comment.body, '');
    }
  }

  if (issue.activity.length > 0) {
    lines.push('## Activity', '');
    for (const event of issue.activity) {
      const fields = event.changes.map((change) => change.field).join(', ');
      lines.push(
        `- ${event.at} — ${event.actor_name} — ${event.type}${fields ? ` (${fields})` : ''}`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function boardMarkdown(
  project: ProjectSummary,
  issues: IssueDetail[],
  filenames: Map<string, string>,
): string {
  const lines: string[] = [
    `# ${project.key} — ${project.name}`,
    '',
    project.description || '_No description._',
    '',
    `Exported ${new Date().toISOString()} · ${issues.length} Issues`,
    '',
  ];
  for (const stage of STAGES) {
    const staged = issues.filter((issue) => issue.stage === stage);
    if (staged.length === 0) continue;
    lines.push(`## ${stageLabel(stage)} (${staged.length})`, '');
    for (const issue of staged) {
      const attributes = [
        `Priority: ${issue.priority}`,
        issue.assignee ? `Assignee: ${issue.assignee.name}` : null,
        issue.blocked ? `Blocked: ${issue.blocked_reason ?? 'yes'}` : null,
      ].filter(Boolean);
      lines.push(
        `- [${issue.key} — ${issue.title}](${filenames.get(issue.id) ?? '#'}) — ${attributes.join(' · ')}`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function attachmentsIndex(issues: IssueDetail[]): string {
  const lines = [
    '# Attachments',
    '',
    '| Issue | File | Size | Type | Text |',
    '|---|---|---|---|---|',
  ];
  for (const issue of issues) {
    for (const attachment of issue.attachments) {
      lines.push(
        `| ${issue.key} | ${attachment.original_name.replaceAll('|', '\\|')} | ${attachment.size_bytes} | ${attachment.mime_type} | ${attachment.has_text ? 'yes' : 'no'} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function projectIssues(db: Database, projectId: string): IssueDetail[] {
  return listIssueRows(db, {
    projectId,
    limit: 100_000,
    sort: 'updated',
  }).map((row) =>
    issueRowToDetail(db, row, { activityLimit: 100_000, commentLimit: 100_000 }),
  );
}

export function buildMarkdownExport(db: Database, projectRef: string): MarkdownExport {
  const row = findProjectRow(db, projectRef);
  if (!row) {
    throw new DomainError('not_found', `Project not found: ${projectRef}`);
  }
  const project = projectRowToSummary(db, row);
  const issues = projectIssues(db, row.id);
  const filenames = new Map(issues.map((issue) => [issue.id, issueFileName(issue)]));

  return {
    filename: `export-${project.key}-${exportStamp()}.zip`,
    entries: [
      { name: '_board.md', content: boardMarkdown(project, issues, filenames) },
      ...issues.map((issue) => ({
        name: issueFileName(issue),
        content: issueMarkdown(issue, filenames),
      })),
      { name: 'attachments/index.md', content: attachmentsIndex(issues) },
    ],
  };
}

export async function zipEntries(entries: ExportEntry[]): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const entry of entries) {
    archive.append(entry.content, { name: entry.name });
  }
  await archive.finalize();
  return done;
}

export interface JsonExport {
  exported_at: string;
  projects: ProjectSummary[];
  modules: unknown[];
  actors: unknown[];
  issues: IssueDetail[];
  links: unknown[];
  attachments: unknown[];
  comments: unknown[];
  activity: unknown[];
}

export function buildJsonExport(db: Database, projectRef?: string): JsonExport {
  const projectRows = projectRef
    ? [findProjectRow(db, projectRef)].filter((row) => row !== undefined)
    : listProjectRows(db);
  if (projectRef && projectRows.length === 0) {
    throw new DomainError('not_found', `Project not found: ${projectRef}`);
  }
  const projects = projectRows.map((row) => projectRowToSummary(db, row!));
  const issues = projectRows.flatMap((row) => projectIssues(db, row!.id));
  return {
    exported_at: new Date().toISOString(),
    projects,
    modules: projects.flatMap((project) => project.modules),
    actors: listActors(db),
    issues,
    links: issues.flatMap((issue) =>
      issue.links.map((link) => ({ issue: issue.key, ...link })),
    ),
    attachments: issues.flatMap((issue) =>
      issue.attachments.map((attachment) => ({ issue: issue.key, ...attachment })),
    ),
    comments: issues.flatMap((issue) =>
      issue.comments.map((comment) => ({ issue: issue.key, ...comment })),
    ),
    activity: projectRows.flatMap((row) =>
      listProjectActivity(db, row!.id, 100_000),
    ),
  };
}

export { exportStamp };