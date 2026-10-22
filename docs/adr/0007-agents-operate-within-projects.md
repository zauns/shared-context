# Agents operate within Projects; Projects are curated in the UI

Projects are created, renamed, and deleted only from the UI. MCP clients can list Projects and create Modules explicitly, but cannot create Projects. A Project key is a stable identifier used in every Issue key, so letting agents create Projects would produce accidental keys and project sprawl. The trade-off is that an agent cannot bootstrap a new Project without a human; this is deliberate.
