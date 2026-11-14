import { claimAvaTask, markAvaTaskFailed, processAvaTask } from "@/lib/ava/workflow-steps";

export async function processAvaTaskWorkflow(taskId: string, ownerId: string) {
  "use workflow";
  const claim = await claimAvaTask(taskId, ownerId);
  if (!claim.claimed) {
    console.log("[Ava] Workflow skipped", taskId, claim.reason);
    return { status: "skipped", reason: claim.reason };
  }
  try {
    const result = await processAvaTask(taskId, ownerId);
    return { status: "SUCCEEDED", ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Ava processing error";
    await markAvaTaskFailed(taskId, ownerId, message);
    throw error;
  }
}
