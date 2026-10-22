# Deletes are soft and keep the Activity trail

Deleting an Issue marks it deleted and hides it from the board; it does not remove the row, its Activity, or its Attachments. Deleting a Parent Issue requires an explicit cascade and soft-deletes the subtree. `cancelled` remains the normal "we are not doing this" Stage, while delete is administrative cleanup. The trade-off is that deleted data still occupies the database until a deliberate purge, which is acceptable for a personal tool and preserves the audit trail.
