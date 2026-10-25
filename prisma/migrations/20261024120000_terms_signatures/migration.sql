-- Drawn signatures on dealer T&C documents, with the document as signed.
-- CreateTable
CREATE TABLE "terms_signatures" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "slot" TEXT NOT NULL,
    "signer_user_id" BIGINT NOT NULL,
    "signer_role" "UserRole" NOT NULL,
    "signer_name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "ip" TEXT,
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terms_signatures_dealer_id_signed_at_idx" ON "terms_signatures"("dealer_id", "signed_at");

-- AddForeignKey
ALTER TABLE "terms_signatures" ADD CONSTRAINT "terms_signatures_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms_signatures" ADD CONSTRAINT "terms_signatures_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
