-- CreateTable
CREATE TABLE "MemberPresence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nwid" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL,
    "sampledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MemberPresence_nwid_memberId_sampledAt_idx" ON "MemberPresence"("nwid", "memberId", "sampledAt");
