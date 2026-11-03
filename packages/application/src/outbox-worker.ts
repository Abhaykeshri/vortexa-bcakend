import { randomUUID } from 'node:crypto';

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly attempts: number;
}

export interface DurableOutboxPort {
  claimOutbox(owner: string, limit: number): Promise<readonly OutboxMessage[]>;
  completeOutbox(id: string, owner: string): Promise<void>;
  failOutbox(
    id: string,
    owner: string,
    error: string,
    maxAttempts: number,
    delaySeconds: number,
  ): Promise<void>;
}

export interface NotificationPort {
  publish(topic: string, payload: unknown): Promise<void>;
}

export class OutboxWorker {
  constructor(
    private readonly outbox: DurableOutboxPort,
    private readonly notifications: NotificationPort,
    private readonly maxAttempts = 8,
  ) {}

  async runOnce(owner: string, limit = 25): Promise<{ processed: number; failed: number }> {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(owner)) throw new Error('Invalid outbox worker identity');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid outbox batch size');
    const claimOwner = `${owner}-${randomUUID()}`;
    let processed = 0;
    let failed = 0;
    for (let index = 0; index < limit; index++) {
      const [message] = await this.outbox.claimOutbox(claimOwner, 1);
      if (!message) break;
      try {
        await this.notifications.publish(message.topic, message.payload);
      } catch (error) {
        const delay = Math.min(2 ** Math.min(message.attempts + 1, 10), 3600);
        await this.outbox.failOutbox(
          message.id,
          claimOwner,
          error instanceof Error ? error.message : 'notification failure',
          this.maxAttempts,
          delay,
        );
        failed++;
        continue;
      }
      await this.outbox.completeOutbox(message.id, claimOwner);
      processed++;
    }
    return { processed, failed };
  }
}
