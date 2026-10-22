# Attachments are copied, and image content is capability-gated

Attachments are copied into the managed data directory instead of referencing the original path, so they survive moves and are backup-able. PDFs get best-effort text extraction without OCR. `read_attachment` returns image content blocks only to Actors marked `can_read_images`; other Actors get metadata, which avoids sending images to models that cannot use them. The trade-offs are duplicate disk usage and a capability flag that must be maintained.
