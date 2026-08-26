-- RSM rejection note.
-- The RSM review UI already sent a note alongside its approve/reject action, but
-- the API only persisted a note for the Admin stage, so an RSM's reason was
-- silently dropped. admin_note stays the Admin's field: the two reviewers are
-- distinct and a resubmit clears each independently.

ALTER TABLE "custom_discount_requests"
  ADD COLUMN IF NOT EXISTS "rsm_note" TEXT;
