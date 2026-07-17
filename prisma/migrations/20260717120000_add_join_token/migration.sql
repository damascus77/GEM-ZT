-- CreateTable
CREATE TABLE "JoinToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nwid" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "JoinToken_hashedToken_key" ON "JoinToken"("hashedToken");

-- CreateIndex
CREATE INDEX "JoinToken_nwid_idx" ON "JoinToken"("nwid");
