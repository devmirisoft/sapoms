-- Per-dealer switch for the T&C document; off hides the gate, page and update notice.
ALTER TABLE "dealer_profiles" ADD COLUMN "terms_active" BOOLEAN NOT NULL DEFAULT true;
