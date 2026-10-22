# Run at logon in the user session, not as a Windows service

The daemon opens attachments with the user's default applications, so it must run inside the interactive logon session. A Windows service runs in session 0 and cannot launch applications on the user's desktop; `start` would silently do the wrong thing or fail. We therefore start the daemon at logon through Task Scheduler and accept that it does not run before the user logs in.
