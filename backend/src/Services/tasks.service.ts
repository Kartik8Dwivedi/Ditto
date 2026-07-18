import { CloudTasksClient } from '@google-cloud/tasks';

import AppConfig from '../Config/AppConfig.js';
import logger from '../Config/logger.js';

/**
 * Cloud Tasks enqueuer for the on-demand path.
 *
 * `/analyze` returns immediately after dropping a task here; Cloud Tasks then
 * pushes it (with the shared secret header) to `/internal/run` on this same
 * service, which does the long-running paid work. The queue's concurrency=1 is
 * what bounds cost and stops a burst of pastes from overloading the key.
 *
 * The client is created lazily so that local dev and the test suite — where
 * Cloud Tasks is unconfigured and there are no GCP credentials — never
 * instantiate it. When {@link isEnabled} is false, the caller runs the job
 * inline instead of enqueuing.
 */
class TasksService {
  private client?: CloudTasksClient;

  /** True only when every piece Cloud Tasks needs is configured. */
  isEnabled(): boolean {
    return AppConfig.TASKS_ENABLED;
  }

  private getClient(): CloudTasksClient {
    if (!this.client) this.client = new CloudTasksClient();
    return this.client;
  }

  /**
   * Enqueue an HTTP push task that will POST `{ jobId }` to `/internal/run`
   * with the `X-Ditto-Task-Secret` header. Assumes {@link isEnabled}; the
   * non-null assertions are safe because that flag requires all five values.
   */
  async enqueueRun(jobId: string): Promise<void> {
    const client = this.getClient();
    const parent = client.queuePath(
      AppConfig.GCP_PROJECT!,
      AppConfig.TASKS_LOCATION!,
      AppConfig.TASKS_QUEUE!
    );

    const url = `${AppConfig.SERVICE_URL!.replace(/\/+$/, '')}/api/v1/internal/run`;

    await client.createTask({
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: {
            'Content-Type': 'application/json',
            'X-Ditto-Task-Secret': AppConfig.TASK_SECRET!,
          },
          body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
        },
      },
    });

    logger.info(`enqueued analysis job ${jobId} to ${AppConfig.TASKS_QUEUE}`);
  }
}

export default TasksService;
