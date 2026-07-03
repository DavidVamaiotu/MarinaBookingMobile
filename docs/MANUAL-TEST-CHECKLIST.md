# Manual test checklist

- [ ] Configure the v1.0.2 API URL, dedicated username, Application Password, and `Europe/Bucharest`; Test connection returns a resource count.
- [ ] Create a pending booking with name/email/phone and note; confirm a local bar appears immediately, then receives a server ID and `synced` state.
- [ ] Drag the booking one day and resize its end; confirm the bar moves immediately and the edit later syncs.
- [ ] Edit client fields and dates in the side panel; confirm the draft remains visible during sync.
- [ ] Approve the booking, then set it pending; verify WordPress and the desktop status color.
- [ ] Change the internal note twice quickly; verify one unsent note command remains and WordPress stores the final note.
- [ ] Trash the booking after confirmation; verify there is no permanent-delete action. Restore it and verify WordPress.
- [ ] Disconnect networking, create and edit a booking, and confirm the toolbar shows offline plus queued commands without UI blocking.
- [ ] Quit while commands are queued, relaunch, and confirm the optimistic bars and commands recover; reconnect and verify sync.
- [ ] Cause an availability rejection and verify `conflict` with Retry, Revert local, and booking details available.
- [ ] Revoke the Application Password and verify outbound sync pauses after 401/403 without repeated requests; replace it and verify Resume.
- [ ] Simulate an unknown create timeout; verify the same command UUID is reconciled through `external_id` and no duplicate booking is created.
