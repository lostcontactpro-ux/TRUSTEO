-- Read-only provider tests are staged until the owner explicitly confirms.
-- Existing API connections retain their status; application polling additionally
-- requires confirmedAt, so a legacy connection must complete the new workflow.
ALTER TABLE "ProviderConnection"
    ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'oauth',
    ADD COLUMN "pendingPreview" TEXT,
    ADD COLUMN "previewTokenHash" TEXT,
    ADD COLUMN "previewExpiresAt" TIMESTAMP(3),
    ADD COLUMN "testedAt" TIMESTAMP(3),
    ADD COLUMN "confirmedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ProviderConnection_previewTokenHash_key" ON "ProviderConnection"("previewTokenHash");
