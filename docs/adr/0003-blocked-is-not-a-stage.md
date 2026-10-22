# Blocked is an orthogonal flag, not a Stage

An Issue can be blocked while it is in any Stage, so Blocked is a condition with a required reason rather than a workflow column. The Stage remains the Issue's real position; blocking and unblocking do not move it. This deviates from the original stage list, which included `blocked` as a Stage, because a blocked review cannot be represented faithfully as a single column. The board keeps a blocked Issue in its Stage column and marks it with a badge; a Blocked filter is available, but there is no Blocked column.
