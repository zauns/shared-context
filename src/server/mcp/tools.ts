import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { currentActivityCursor } from '../db/repositories/activities.js';
import { identifyActor, requireActorRow } from '../domain/actors.js';
import { addComment } from '../domain/comments.js';
import { removeAttachment } from '../domain/attachments.js';
import { DomainError } from '../domain/errors.js';
import {
  blockIssue,
  claimIssue,
  createIssue,
  deleteIssue,
  getBoard,
  getIssue,
  listIssues,
  moveIssue,
  releaseIssue,
  unblockIssue,
  updateIssue,
} from '../domain/issues.js';
import { addLink, removeLink } from '../domain/links.js';
import { createModule } from '../domain/modules.js';
import {
  getProject,
  getProjectContext,
  listProjects,
  readProjectDocument,
} from '../domain/projects.js';
import { PRIORITIES, STAGES } from '../domain/types.js';
import {
  publishActivitiesSince,
  waitForChange,
} from '../services/change-bus.js';
import {
  addAttachmentFromPath,
  readAttachmentForActor,
} from '../services/attachments.js';
import { mutateWithPublish } from '../services/mutations.js';
import type { McpDeps, McpSessionState } from './state.js';
import { toolOk, wrapTool } from './results.js';

function sessionActor(
  deps: McpDeps,
  state: McpSessionState,
  override?: string,
): ReturnType<typeof requireActorRow> {
  const ref = override ?? state.actorId;
  if (!ref) {
    throw new DomainError('actor_required', 'Call identify before mutating Issues');
  }
  return requireActorRow(deps.db, ref);
}

function sessionProject(
  deps: McpDeps,
  state: McpSessionState,
  ref?: string,
): ReturnType<typeof getProject> {
  const target = ref ?? state.defaultProjectId;
  if (!target) {
    throw new DomainError('project_required', 'Pass project or set default_project in identify');
  }
  const project = getProject(deps.db, target);
  state.defaultProjectId = project.id;
  return project;
}

export function registerTools(
  server: McpServer,
  deps: McpDeps,
  state: McpSessionState,
): void {
  const { db, config, bus } = deps;

  // Wrap every handler so DomainError becomes the structured, parseable MCP
  // error envelope instead of the SDK's plain-text fallback.
  type RegisterTool = (
    name: string,
    config: unknown,
    handler: (...args: unknown[]) => unknown,
  ) => unknown;
  const rawRegister = server.registerTool.bind(server) as RegisterTool;
  const wrappedRegister: RegisterTool = (name, config, handler) =>
    rawRegister(name, config, async (args, extra) =>
      wrapTool(() => handler(args, extra)),
    );
  (server as unknown as { registerTool: RegisterTool }).registerTool = wrappedRegister;

  server.registerTool(
    'identify',
    {
      description:
        'Bind this MCP session to an Actor and optional default Project. Call once at the start of a session, and again after a reconnect. Mutations without an Actor return actor_required.',
      inputSchema: {
        actor: z.string().describe('Actor name, for example frontend-agent'),
        default_project: z.string().optional().describe('Project key or id'),
        can_read_images: z.boolean().optional().describe('Whether this Actor may receive image content'),
        kind: z.enum(['human', 'agent']).optional(),
      },
    },
    async (args) => {
      const actor = identifyActor(db, {
        name: args.actor,
        kind: args.kind,
        can_read_images: args.can_read_images,
      });
      state.actorId = actor.id;
      state.actorName = actor.name;
      state.canReadImages = actor.can_read_images;
      let project = null;
      if (args.default_project) {
        project = getProject(db, args.default_project);
        state.defaultProjectId = project.id;
      }
      return toolOk({ actor, default_project: project });
    },
  );

  server.registerTool(
    'wait_for_change',
    {
      description:
        'Wait for Activity after a cursor. Returns persisted events immediately, or wakes after a commit. Use the returned cursor for the next wait. timeout_seconds is capped at 60.',
      inputSchema: {
        since_activity_id: z.number().int().min(0),
        project: z.string().optional(),
        timeout_seconds: z.number().int().min(1).max(60).optional(),
      },
    },
    async (args) => {
      const projectId = args.project
        ? getProject(db, args.project).id
        : state.defaultProjectId;
      const result = await waitForChange(db, bus, {
        since: args.since_activity_id,
        projectId,
        timeoutMs: (args.timeout_seconds ?? 60) * 1000,
      });
      return toolOk({
        events: result.events,
        cursor: result.cursor,
        timed_out: result.timed_out,
      });
    },
  );

  server.registerTool(
    'list_projects',
    {
      description: 'List Projects with counts by Stage and Priority.',
      inputSchema: {},
    },
    async () => toolOk({ items: listProjects(db) }),
  );

  server.registerTool(
    'get_project_context',
    {
      description:
        'Return a Context Snapshot: project metadata, counts, modules, blocked Issues, your active Issues, recent Activity, and allowlisted docs.',
      inputSchema: {
        project: z.string().optional(),
      },
    },
    async (args) => {
      const project = sessionProject(deps, state, args.project);
      return toolOk(getProjectContext(db, project.key, state.actorId));
    },
  );

  server.registerTool(
    'read_project_doc',
    {
      description:
        'Read an allowlisted project document (AGENTS.md, CONTEXT.md, README.md, docs/**/*.md or .txt). Max 256 KB.',
      inputSchema: {
        path: z.string(),
        project: z.string().optional(),
      },
    },
    async (args) => {
      const project = sessionProject(deps, state, args.project);
      return toolOk(readProjectDocument(db, project.key, args.path));
    },
  );

  server.registerTool(
    'create_module',
    {
      description:
        'Create a project-scoped Module. Module names are curated; reuse existing modules from get_project_context when possible.',
      inputSchema: {
        name: z.string(),
        project: z.string().optional(),
        color: z.string().nullable().optional(),
      },
    },
    async (args) => {
      const project = sessionProject(deps, state, args.project);
      return toolOk(
        createModule(db, {
          project: project.key,
          name: args.name,
          color: args.color,
        }),
      );
    },
  );

  server.registerTool(
    'create_issue',
    {
      description:
        'Create an Issue. Title is required; Stage defaults to backlog and Priority to none. Attachments are absolute local paths and are copied into the managed store.',
      inputSchema: {
        project: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        stage: z.enum(STAGES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assignee: z.string().optional(),
        module: z.string().optional(),
        parent: z.string().optional(),
        links: z
          .array(z.object({ url: z.string(), label: z.string().optional() }))
          .optional(),
        attachments: z
          .array(
            z.union([
              z.string(),
              z.object({ path: z.string(), name: z.string().optional() }),
            ]),
          )
          .optional(),
        client_request_id: z.string().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const project = sessionProject(deps, state, args.project);
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        createIssue(db, {
          project: project.key,
          title: args.title,
          description: args.description,
          stage: args.stage,
          priority: args.priority,
          assignee: args.assignee,
          module: args.module,
          parent: args.parent,
          links: args.links?.map((link) => ({
            url: link.url,
            label: link.label,
          })),
          client_request_id: args.client_request_id,
          actor: actor.id,
        }),
      );

      const attachmentErrors: Array<{ path: string; code: string; message: string }> = [];
      for (const item of args.attachments ?? []) {
        const filePath = typeof item === 'string' ? item : item.path;
        const name = typeof item === 'string' ? undefined : item.name;
        const before = currentActivityCursor(db);
        try {
          await addAttachmentFromPath(db, config, {
            issue: result.issue.id,
            filePath,
            name,
            actor: actor.id,
          });
          publishActivitiesSince(db, bus, before);
        } catch (error) {
          attachmentErrors.push({
            path: filePath,
            code: error instanceof DomainError ? error.code : 'internal_error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return toolOk({
        created: result.created,
        issue: getIssue(db, result.issue.key),
        ...(attachmentErrors.length > 0 ? { attachment_errors: attachmentErrors } : {}),
      });
    },
  );

  server.registerTool(
    'get_issue',
    {
      description:
        'Read an Issue with children, links, attachments, comments, activity, child progress, and counts.',
      inputSchema: {
        issue: z.string(),
        activity_limit: z.number().int().min(0).max(200).optional(),
        comment_limit: z.number().int().min(0).max(200).optional(),
      },
    },
    async (args) =>
      toolOk({
        issue: getIssue(db, args.issue, {
          activityLimit: args.activity_limit,
          commentLimit: args.comment_limit,
        }),
      }),
  );

  server.registerTool(
    'list_issues',
    {
      description:
        'List Issues with filters. AND across filter types, OR within a multi-select. Use compact view for cards and full view for details.',
      inputSchema: {
        project: z.string().optional(),
        q: z.string().optional(),
        stages: z.array(z.enum(STAGES)).optional(),
        priorities: z.array(z.enum(PRIORITIES)).optional(),
        assignee: z.string().optional(),
        module: z.string().optional(),
        parent: z.string().optional(),
        blocked: z.boolean().optional(),
        has_attachments: z.boolean().optional(),
        updated_since: z.string().optional(),
        include_deleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        cursor: z.string().optional(),
        view: z.enum(['compact', 'full']).optional(),
        sort: z.enum(['updated', 'priority', 'position']).optional(),
      },
    },
    async (args) => {
      const project = sessionProject(deps, state, args.project);
      return toolOk(
        listIssues(db, {
          project: project.key,
          q: args.q,
          stages: args.stages,
          priorities: args.priorities,
          assignee: args.assignee,
          module: args.module,
          parent: args.parent,
          blocked: args.blocked,
          has_attachments: args.has_attachments,
          updated_since: args.updated_since,
          include_deleted: args.include_deleted,
          limit: args.limit,
          cursor: args.cursor,
          view: args.view,
          sort: args.sort,
        }),
      );
    },
  );

  server.registerTool(
    'get_board',
    {
      description:
        'Read the compact board: one column per Stage, counts, and filtered cards ordered by position.',
      inputSchema: {
        project: z.string().optional(),
        q: z.string().optional(),
        priorities: z.array(z.enum(PRIORITIES)).optional(),
        assignee: z.string().optional(),
        module: z.string().optional(),
        parent: z.string().optional(),
        blocked: z.boolean().optional(),
        has_attachments: z.boolean().optional(),
        updated_since: z.string().optional(),
        include_deleted: z.boolean().optional(),
        include_closed: z.boolean().optional(),
      },
    },
    async (args) => {
      const project = sessionProject(deps, state, args.project);
      return toolOk(
        getBoard(db, {
          project: project.key,
          q: args.q,
          priorities: args.priorities,
          assignee: args.assignee,
          module: args.module,
          parent: args.parent,
          blocked: args.blocked,
          has_attachments: args.has_attachments,
          updated_since: args.updated_since,
          include_deleted: args.include_deleted,
          include_closed: args.include_closed,
        }),
      );
    },
  );

  server.registerTool(
    'update_issue',
    {
      description:
        'Update core Issue fields. Requires expected_rev; a conflict returns the current Issue. Use move_issue for Stage and block_issue for Blocked.',
      inputSchema: {
        issue: z.string(),
        expected_rev: z.number().int().positive(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(PRIORITIES).optional(),
        assignee: z.string().nullable().optional(),
        module: z.string().nullable().optional(),
        parent: z.string().nullable().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        updateIssue(db, {
          issue: args.issue,
          expected_rev: args.expected_rev,
          title: args.title,
          description: args.description,
          priority: args.priority,
          assignee: args.assignee,
          module: args.module,
          parent: args.parent,
          actor: actor.id,
        }),
      );
      return toolOk({ changed: result.changed, issue: result.issue });
    },
  );

  server.registerTool(
    'move_issue',
    {
      description:
        'Move an Issue to a Stage, optionally at a position. Requires expected_rev. Moving to done/cancelled sets the timestamp.',
      inputSchema: {
        issue: z.string(),
        expected_rev: z.number().int().positive(),
        stage: z.enum(STAGES),
        position: z.number().finite().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        moveIssue(db, {
          issue: args.issue,
          expected_rev: args.expected_rev,
          stage: args.stage,
          position: args.position,
          actor: actor.id,
        }),
      );
      return toolOk({ changed: result.changed, issue: result.issue });
    },
  );

  server.registerTool(
    'claim_issue',
    {
      description:
        'Atomically claim an Issue. Succeeds only if it is unassigned or already yours. Backlog/todo move to in_progress; review stays review. Call this before starting work.',
      inputSchema: {
        issue: z.string(),
        expected_rev: z.number().int().positive().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        claimIssue(db, {
          issue: args.issue,
          expected_rev: args.expected_rev,
          actor: actor.id,
        }),
      );
      return toolOk({
        claimed: result.claimed,
        already_owned: result.already_owned,
        issue: result.issue,
      });
    },
  );

  server.registerTool(
    'release_issue',
    {
      description:
        'Release an Issue you own, or a human Actor may release any Issue. Stage is unchanged.',
      inputSchema: {
        issue: z.string(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        releaseIssue(db, { issue: args.issue, actor: actor.id }),
      );
      return toolOk({ released: result.released, issue: result.issue });
    },
  );

  server.registerTool(
    'block_issue',
    {
      description:
        'Block an Issue with a required reason. The Stage does not change. Requires expected_rev.',
      inputSchema: {
        issue: z.string(),
        expected_rev: z.number().int().positive(),
        reason: z.string(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        blockIssue(db, {
          issue: args.issue,
          expected_rev: args.expected_rev,
          reason: args.reason,
          actor: actor.id,
        }),
      );
      return toolOk({ changed: result.changed, issue: result.issue });
    },
  );

  server.registerTool(
    'unblock_issue',
    {
      description: 'Clear an Issue block. The Stage does not change. Requires expected_rev.',
      inputSchema: {
        issue: z.string(),
        expected_rev: z.number().int().positive(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        unblockIssue(db, {
          issue: args.issue,
          expected_rev: args.expected_rev,
          actor: actor.id,
        }),
      );
      return toolOk({ changed: result.changed, issue: result.issue });
    },
  );

  server.registerTool(
    'delete_issue',
    {
      description:
        'Soft-delete an Issue. Children require cascade=true. Requires expected_rev. Restore is UI-only.',
      inputSchema: {
        issue: z.string(),
        expected_rev: z.number().int().positive(),
        cascade: z.boolean().optional(),
        reason: z.string().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = mutateWithPublish(db, bus, () =>
        deleteIssue(db, {
          issue: args.issue,
          expected_rev: args.expected_rev,
          cascade: args.cascade,
          reason: args.reason,
          actor: actor.id,
        }),
      );
      return toolOk(result);
    },
  );

  server.registerTool(
    'add_attachment',
    {
      description:
        'Copy a local file into the managed attachment store. Absolute path; images, .txt, .md, and .pdf up to 25 MB. Deduplicated by SHA-256 per Issue.',
      inputSchema: {
        issue: z.string(),
        path: z.string(),
        name: z.string().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const before = currentActivityCursor(db);
      const result = await addAttachmentFromPath(db, config, {
        issue: args.issue,
        filePath: args.path,
        name: args.name,
        actor: actor.id,
      });
      publishActivitiesSince(db, bus, before);
      return toolOk({
        attachment: result.attachment,
        deduplicated: result.deduplicated,
      });
    },
  );

  server.registerTool(
    'remove_attachment',
    {
      description: 'Soft-delete an Attachment from an Issue. The file remains until purge.',
      inputSchema: {
        issue: z.string(),
        attachment_id: z.string(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      mutateWithPublish(db, bus, () =>
        removeAttachment(db, {
          issue: args.issue,
          attachment_id: args.attachment_id,
          actor: actor.id,
        }),
      );
      return toolOk({ removed: args.attachment_id });
    },
  );

  server.registerTool(
    'read_attachment',
    {
      description:
        'Read an Attachment. Text and Markdown return text; PDFs return extracted text when available; images return an image content block only for Actors with can_read_images.',
      inputSchema: {
        attachment_id: z.string(),
        mode: z.enum(['auto', 'text', 'metadata']).optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const result = await readAttachmentForActor(db, config, {
        attachmentId: args.attachment_id,
        actor: actor.id,
        mode: args.mode,
      });
      if (result.image) {
        return toolOk(
          {
            attachment: result.attachment,
            image: { mime_type: result.image.mimeType },
          },
          [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType }],
        );
      }
      return toolOk({
        attachment: result.attachment,
        ...(result.text !== undefined
          ? { text: result.text, truncated: result.truncated ?? false }
          : {}),
      });
    },
  );

  server.registerTool(
    'add_link',
    {
      description: 'Attach an http/https URL to an Issue. Links are not Attachments.',
      inputSchema: {
        issue: z.string(),
        url: z.string(),
        label: z.string().nullable().optional(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const link = mutateWithPublish(db, bus, () =>
        addLink(db, {
          issue: args.issue,
          url: args.url,
          label: args.label ?? null,
          actor: actor.id,
        }),
      );
      return toolOk({ link });
    },
  );

  server.registerTool(
    'remove_link',
    {
      description: 'Remove a Link from an Issue.',
      inputSchema: {
        issue: z.string(),
        link_id: z.string(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      mutateWithPublish(db, bus, () =>
        removeLink(db, {
          issue: args.issue,
          link_id: args.link_id,
          actor: actor.id,
        }),
      );
      return toolOk({ removed: args.link_id });
    },
  );

  server.registerTool(
    'add_comment',
    {
      description:
        'Add a Markdown comment to an Issue. Use this for handoffs, blockers, and decisions; comments are separate from Activity.',
      inputSchema: {
        issue: z.string(),
        body: z.string(),
        actor: z.string().optional(),
      },
    },
    async (args) => {
      const actor = sessionActor(deps, state, args.actor);
      const comment = mutateWithPublish(db, bus, () =>
        addComment(db, { issue: args.issue, body: args.body, actor: actor.id }),
      );
      return toolOk({ comment });
    },
  );
}
