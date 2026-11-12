CREATE TABLE "Course" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "lecturer" TEXT, "semester" TEXT, "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");
CREATE INDEX "Course_active_code_idx" ON "Course"("active", "code");

CREATE TABLE "LectureSession" (
  "id" TEXT NOT NULL, "courseId" TEXT, "topic" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '', "scheduledAt" TIMESTAMP(3), "heldAt" TIMESTAMP(3),
  "venue" TEXT, "lecturer" TEXT, "sourceDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LectureSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LectureSession_courseId_heldAt_idx" ON "LectureSession"("courseId", "heldAt");
CREATE INDEX "LectureSession_scheduledAt_idx" ON "LectureSession"("scheduledAt");
ALTER TABLE "LectureSession" ADD CONSTRAINT "LectureSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Assignment" (
  "id" TEXT NOT NULL, "courseId" TEXT, "title" TEXT NOT NULL,
  "details" TEXT NOT NULL DEFAULT '', "dueAt" TIMESTAMP(3),
  "status" "TaskStatus" NOT NULL DEFAULT 'TODO', "submissionInstructions" TEXT,
  "source" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Assignment_status_dueAt_idx" ON "Assignment"("status", "dueAt");
CREATE INDEX "Assignment_courseId_dueAt_idx" ON "Assignment"("courseId", "dueAt");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AttendanceSummary" (
  "id" TEXT NOT NULL, "courseId" TEXT, "sessionDate" TIMESTAMP(3) NOT NULL,
  "presentCount" INTEGER NOT NULL DEFAULT 0, "absentCount" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceSummary_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceSummary_courseId_sessionDate_idx" ON "AttendanceSummary"("courseId", "sessionDate");
ALTER TABLE "AttendanceSummary" ADD CONSTRAINT "AttendanceSummary_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ClassConcern" (
  "id" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT 'GENERAL', "title" TEXT NOT NULL,
  "details" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassConcern_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClassConcern_status_updatedAt_idx" ON "ClassConcern"("status", "updatedAt");

CREATE TABLE "AnnouncementVersion" (
  "id" TEXT NOT NULL, "announcementId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL, "status" "AnnouncementStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnnouncementVersion_announcementId_version_key" ON "AnnouncementVersion"("announcementId", "version");
CREATE INDEX "AnnouncementVersion_announcementId_createdAt_idx" ON "AnnouncementVersion"("announcementId", "createdAt");
ALTER TABLE "AnnouncementVersion" ADD CONSTRAINT "AnnouncementVersion_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
