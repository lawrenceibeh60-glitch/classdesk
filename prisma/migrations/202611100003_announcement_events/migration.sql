CREATE TABLE "AnnouncementEvent" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnnouncementEvent_announcementId_createdAt_idx" ON "AnnouncementEvent"("announcementId", "createdAt");
ALTER TABLE "AnnouncementEvent" ADD CONSTRAINT "AnnouncementEvent_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
