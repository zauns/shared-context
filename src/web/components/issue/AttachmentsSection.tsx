import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiError } from '../../api/client.js';
import type { Attachment, IssueDetail } from '../../api/types.js';
import { formatBytes, relativeTime } from '../../lib/board.js';
import { Spinner } from '../common/Feedback.js';
import { useToast } from '../common/Toast.js';

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.pdf';

function textStatus(attachment: Attachment): string | null {
  if (attachment.mime_type === 'application/pdf') {
    return attachment.has_text ? 'Text extracted' : 'No extractable text';
  }
  if (attachment.mime_type.startsWith('text/')) {
    return attachment.has_text ? 'Text' : 'Empty text file';
  }
  return null;
}

export default function AttachmentsSection({ issue }: { issue: IssueDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
    await queryClient.invalidateQueries({ queryKey: ['board', issue.project.key] });
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    for (const file of list) {
      setUploading(file.name);
      try {
        const result = await api.uploadAttachment(issue.key, file);
        toast.push(
          result.deduplicated
            ? `${file.name} is already attached to this Issue.`
            : `Attached ${file.name}.`,
          result.deduplicated ? 'info' : 'success',
        );
      } catch (cause) {
        const message =
          cause instanceof ApiError ? cause.message : `Could not upload ${file.name}`;
        setError(message);
        toast.push(message, 'error');
      }
    }
    setUploading(null);
    await refresh();
  }

  async function openAttachment(attachment: Attachment) {
    setOpeningId(attachment.id);
    try {
      await api.openAttachment(attachment.id);
      toast.push(`Opening ${attachment.original_name} with the default application.`, 'info');
    } catch (cause) {
      toast.push(
        cause instanceof ApiError ? cause.message : 'Could not open the Attachment',
        'error',
      );
    } finally {
      setOpeningId(null);
    }
  }

  async function removeAttachment(attachment: Attachment) {
    setRemovingId(attachment.id);
    try {
      await api.deleteAttachment(attachment.id);
      setConfirmId(null);
      await refresh();
      toast.push(`Removed ${attachment.original_name}.`, 'success');
    } catch (cause) {
      toast.push(
        cause instanceof ApiError ? cause.message : 'Could not remove the Attachment',
        'error',
      );
    } finally {
      setRemovingId(null);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(event.dataTransfer.files);
  }

  function onDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <section data-testid="attachments-section">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
          <Paperclip size={12} /> Attachments
          <span className="chip">{issue.attachments.length}</span>
        </h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => inputRef.current?.click()}
          disabled={uploading !== null}
        >
          <Upload size={13} />
          Upload
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) void uploadFiles(files);
        }}
      />

      {issue.attachments.length > 0 ? (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {issue.attachments.map((attachment) => {
            const status = textStatus(attachment);
            return (
              <article
                key={attachment.id}
                className="overflow-hidden rounded-lg border border-subtle"
              >
                <button
                  type="button"
                  className="flex h-24 w-full items-center justify-center bg-[var(--surface-2)] transition hover:bg-[var(--surface-3)]"
                  onClick={() => void openAttachment(attachment)}
                  aria-label={`Open ${attachment.original_name} with the default application`}
                  title="Open with the default application"
                  disabled={openingId === attachment.id}
                >
                  {attachment.is_image ? (
                    <img
                      src={api.attachmentContentUrl(attachment.id)}
                      alt={attachment.original_name}
                      loading="lazy"
                      className="h-24 w-full object-cover"
                    />
                  ) : attachment.mime_type === 'application/pdf' ? (
                    <FileText size={30} className="muted" />
                  ) : (
                    <ImageIcon size={30} className="muted" />
                  )}
                </button>
                <div className="p-2">
                  <p
                    className="truncate text-xs font-medium"
                    title={attachment.original_name}
                  >
                    {attachment.original_name}
                  </p>
                  <p className="mt-0.5 text-[10px] muted">
                    {formatBytes(attachment.size_bytes)} · {attachment.created_by.name} ·{' '}
                    {relativeTime(attachment.created_at)}
                  </p>
                  {status ? (
                    <span
                      className={`chip mt-1 ${
                        attachment.has_text ? '' : 'priority-medium'
                      }`}
                    >
                      {status}
                    </span>
                  ) : null}
                  <div className="mt-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost px-1.5 py-0.5"
                      onClick={() => void openAttachment(attachment)}
                      disabled={openingId === attachment.id}
                      title="Open with the OS"
                    >
                      <ExternalLink size={12} />
                      Open
                    </button>
                    <a
                      className="btn btn-ghost px-1.5 py-0.5"
                      href={api.attachmentContentUrl(attachment.id, true)}
                      download={attachment.original_name}
                      title="Download"
                    >
                      <Download size={12} />
                      Save
                    </a>
                    <button
                      type="button"
                      className="btn btn-ghost ml-auto px-1.5 py-0.5 text-[var(--danger)]"
                      onClick={() => setConfirmId(attachment.id)}
                      title="Remove Attachment"
                      aria-label={`Remove ${attachment.original_name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {confirmId === attachment.id ? (
                    <div className="mt-1.5 rounded-md border border-[var(--danger)] p-1.5 text-[10px]">
                      <p>Remove this Attachment?</p>
                      <div className="mt-1 flex gap-1">
                        <button
                          type="button"
                          className="btn btn-danger px-1.5 py-0.5"
                          onClick={() => void removeAttachment(attachment)}
                          disabled={removingId === attachment.id}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-0.5"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="mb-2 text-xs muted">No Attachments.</p>
      )}

      <div
        role="button"
        tabIndex={0}
        data-testid="attachment-dropzone"
        className={`flex min-h-16 cursor-pointer items-center justify-center rounded-lg border border-dashed px-3 py-3 text-center text-[11px] transition ${
          dragActive
            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
            : 'border-subtle hover:border-[var(--accent)]'
        }`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={onDropzoneKeyDown}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <Spinner label={`Uploading ${uploading}…`} />
        ) : (
          <span className="muted">
            Drop files here or click to browse. PNG, JPEG, GIF, WebP, TXT, MD, PDF up
            to 25 MB.
          </span>
        )}
      </div>
      {error ? <p className="mt-1 text-[11px] text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}